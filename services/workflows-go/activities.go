// Activities for the policy-twin Temporal workflows (ADR-010).
//
// Every activity shells out to HTTP endpoints that ALREADY EXIST on the
// Python services — Temporal adds durable orchestration around them, it does
// not re-implement business logic:
//
//	ingestion:  POST /v1/ingest/{connector}          (start connector run)
//	            GET  /v1/ingest/jobs/{job_id}        (poll status/result)
//	simulation: POST /v1/scenario-runs               (submit run)
//	            GET  /v1/scenario-runs/{run_id}      (poll completion)
//
// Event emission uses the Redpanda/Kafka topics from infra/events/topics.json
// so existing Node consumers (api/consumers.ts) pick up downstream refreshes.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
	"go.temporal.io/sdk/activity"
)

const (
	// Kafka topics (parity with contracts/entities.ts EventTopics).
	topicFeaturesMaterialized    = "features.materialized"
	topicSimulationsRunCompleted = "simulations.run.completed"
)

type httpClient interface {
	Do(req *http.Request) (*http.Response, error)
}

// Activities holds the activity set; dependencies are injected so the unit
// tests (workflows_test.go) can run against a mock HTTP server / producer.
type Activities struct {
	IngestionBaseURL string
	SimulationBaseURL string
	PlatformAPIURL   string
	KafkaBrokers     []string
	HTTP             httpClient
	// Produce, when nil, uses a franz-go client against KafkaBrokers.
	// Tests inject a stub.
	Produce func(ctx context.Context, topic string, key string, payload []byte) error
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

// NewActivities builds the activity set from the environment.
func NewActivities() *Activities {
	brokers := strings.Split(envOr("KAFKA_BROKERS", "redpanda:9092"), ",")
	return &Activities{
		IngestionBaseURL:  envOr("INGESTION_BASE_URL", "http://localhost:8300"),
		SimulationBaseURL: envOr("SIMULATION_BASE_URL", "http://localhost:8100"),
		PlatformAPIURL:    envOr("PLATFORM_API_URL", "http://localhost:3000"),
		KafkaBrokers:      brokers,
		HTTP:              &http.Client{Timeout: 30 * time.Second},
	}
}

/* ---------------------------- shared helpers ---------------------------- */

func (a *Activities) doJSON(ctx context.Context, method, url string, body any) ([]byte, int, error) {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, 0, fmt.Errorf("marshal request: %w", err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return nil, 0, fmt.Errorf("build request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := a.HTTP.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("%s %s: %w", method, url, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("read body: %w", err)
	}
	if resp.StatusCode >= 400 {
		return raw, resp.StatusCode, fmt.Errorf("%s %s: HTTP %d: %s", method, url, resp.StatusCode, truncate(raw, 400))
	}
	return raw, resp.StatusCode, nil
}

func truncate(b []byte, n int) string {
	if len(b) > n {
		return string(b[:n]) + "..."
	}
	return string(b)
}

// unwrapData extracts the platform envelope {"data": ...} when present.
func unwrapData(raw []byte, out any) error {
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &env); err == nil && len(env.Data) > 0 {
		return json.Unmarshal(env.Data, out)
	}
	return json.Unmarshal(raw, out)
}

func (a *Activities) produce(ctx context.Context, topic, key string, payload []byte) error {
	if a.Produce != nil {
		return a.Produce(ctx, topic, key, payload)
	}
	client, err := kgo.NewClient(kgo.SeedBrokers(a.KafkaBrokers...))
	if err != nil {
		return fmt.Errorf("kafka client: %w", err)
	}
	defer client.Close()
	rec := &kgo.Record{Topic: topic, Key: []byte(key), Value: payload}
	if err := client.ProduceSync(ctx, rec).FirstErr(); err != nil {
		return fmt.Errorf("produce %s: %w", topic, err)
	}
	return nil
}

/* ---------------------- ingestion pipeline activities -------------------- */

type IngestionInput struct {
	Connector    string         `json:"connector"`
	Jurisdiction string         `json:"jurisdiction"`
	Since        string         `json:"since,omitempty"`
	Params       map[string]any `json:"params,omitempty"`
}

type ConnectorRun struct {
	JobID   string `json:"job_id"`
	Status  string `json:"status"`
	PollURL string `json:"poll"`
}

// RunConnector starts a connector run on the ingestion service
// (POST /v1/ingest/{connector}, which returns 202 + job_id).
func (a *Activities) RunConnector(ctx context.Context, in IngestionInput) (ConnectorRun, error) {
	activity.GetLogger(ctx).Info("RunConnector", "connector", in.Connector, "jurisdiction", in.Jurisdiction)
	url := fmt.Sprintf("%s/v1/ingest/%s", a.IngestionBaseURL, in.Connector)
	body := map[string]any{
		"jurisdiction": in.Jurisdiction,
	}
	if in.Since != "" {
		body["since"] = in.Since
	}
	if len(in.Params) > 0 {
		body["params"] = in.Params
	}
	raw, _, err := a.doJSON(ctx, http.MethodPost, url, body)
	if err != nil {
		return ConnectorRun{}, err
	}
	var run ConnectorRun
	if err := unwrapData(raw, &run); err != nil {
		return ConnectorRun{}, fmt.Errorf("decode connector run: %w", err)
	}
	if run.JobID == "" {
		return ConnectorRun{}, fmt.Errorf("ingestion service returned no job_id: %s", truncate(raw, 200))
	}
	return run, nil
}

type IngestionJob struct {
	JobID   string `json:"job_id"`
	Status  string `json:"status"` // queued|running|succeeded|failed
	Error   string `json:"error,omitempty"`
	Summary struct {
		RecordsIn  int `json:"records_in"`
		RecordsOut int `json:"records_out"`
		Contract   struct {
			SchemaOK bool `json:"schema_ok"`
		} `json:"contract"`
		Loader struct {
			Status  string `json:"status"`
			Applied int    `json:"applied"`
		} `json:"loader"`
	} `json:"summary"`
}

// pollJob fetches one job status snapshot (GET /v1/ingest/jobs/{job_id}).
func (a *Activities) pollJob(ctx context.Context, jobID string) (IngestionJob, error) {
	url := fmt.Sprintf("%s/v1/ingest/jobs/%s", a.IngestionBaseURL, jobID)
	raw, _, err := a.doJSON(ctx, http.MethodGet, url, nil)
	if err != nil {
		return IngestionJob{}, err
	}
	var job IngestionJob
	if err := unwrapData(raw, &job); err != nil {
		return IngestionJob{}, fmt.Errorf("decode job: %w", err)
	}
	return job, nil
}

// ValidateBatch waits (with heartbeats) for the connector job to finish and
// enforces the data contract: a run whose contract check failed is a
// non-retryable application error.
func (a *Activities) ValidateBatch(ctx context.Context, run ConnectorRun) (IngestionJob, error) {
	logger := activity.GetLogger(ctx)
	for {
		job, err := a.pollJob(ctx, run.JobID)
		if err != nil {
			return IngestionJob{}, err // transient HTTP errors retry per policy
		}
		activity.RecordHeartbeat(ctx, job.Status)
		switch job.Status {
		case "succeeded":
			if !job.Summary.Contract.SchemaOK {
				return job, fmt.Errorf("data contract failed for connector run %s", run.JobID)
			}
			logger.Info("ValidateBatch ok", "job", run.JobID, "records_out", job.Summary.RecordsOut)
			return job, nil
		case "failed":
			return job, fmt.Errorf("ingestion job %s failed: %s", run.JobID, job.Error)
		}
		select {
		case <-ctx.Done():
			return IngestionJob{}, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}

// LoadCanonical verifies the loader outcome recorded by the ingestion
// pipeline (pipeline.py already loads canonical records; loader failures are
// recorded, not raised). This activity turns a recorded loader failure into
// a workflow-visible failure, and is idempotent: re-running it re-reads the
// same job record.
func (a *Activities) LoadCanonical(ctx context.Context, job IngestionJob) (IngestionJob, error) {
	activity.GetLogger(ctx).Info("LoadCanonical", "job", job.JobID, "loader_status", job.Summary.Loader.Status)
	switch job.Summary.Loader.Status {
	case "", "ok", "applied", "loaded", "success", "skipped":
		return job, nil
	default:
		return job, fmt.Errorf("loader did not apply canonical records for job %s (status=%s)", job.JobID, job.Summary.Loader.Status)
	}
}

// RefreshAlerts re-emits features.materialized for the loaded batch so the
// existing Node consumers (api/consumers.ts) refresh alerts/recommendations
// downstream — the same mechanism the in-service pipeline uses.
func (a *Activities) RefreshAlerts(ctx context.Context, job IngestionJob) (string, error) {
	payload, err := json.Marshal(map[string]any{
		"source":      "temporal",
		"workflow":    "IngestionPipelineWorkflow",
		"job_id":      job.JobID,
		"records_out": job.Summary.RecordsOut,
		"emitted_at":  time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		return "", err
	}
	if err := a.produce(ctx, topicFeaturesMaterialized, job.JobID, payload); err != nil {
		return "", err
	}
	activity.GetLogger(ctx).Info("RefreshAlerts emitted", "topic", topicFeaturesMaterialized, "job", job.JobID)
	return topicFeaturesMaterialized, nil
}

/* ----------------------- simulation run activities ----------------------- */

type SimulationInput struct {
	ScenarioID string `json:"scenario_id"`
	Engine     string `json:"engine"`
	Seed       int64  `json:"seed"`
	Horizon    int    `json:"horizon_months"`
}

type SimulationRun struct {
	RunID  string `json:"run_id"`
	Status string `json:"status"` // queued|running|succeeded|failed|cancelled
	Result any    `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
}

// SubmitRun posts a scenario run to the simulation service
// (POST /v1/scenario-runs → {run_id, status}).
func (a *Activities) SubmitRun(ctx context.Context, in SimulationInput) (SimulationRun, error) {
	activity.GetLogger(ctx).Info("SubmitRun", "scenario", in.ScenarioID, "engine", in.Engine)
	raw, _, err := a.doJSON(ctx, http.MethodPost, a.SimulationBaseURL+"/v1/scenario-runs", map[string]any{
		"scenario_id":    in.ScenarioID,
		"engine":         in.Engine,
		"seed":           in.Seed,
		"horizon_months": in.Horizon,
	})
	if err != nil {
		return SimulationRun{}, err
	}
	var run SimulationRun
	if err := unwrapData(raw, &run); err != nil {
		return SimulationRun{}, fmt.Errorf("decode run: %w", err)
	}
	if run.RunID == "" {
		return SimulationRun{}, fmt.Errorf("simulation service returned no run_id: %s", truncate(raw, 200))
	}
	return run, nil
}

// PollCompletion waits (with heartbeats) for the run to reach a terminal
// status via GET /v1/scenario-runs/{run_id}.
func (a *Activities) PollCompletion(ctx context.Context, run SimulationRun) (SimulationRun, error) {
	for {
		url := fmt.Sprintf("%s/v1/scenario-runs/%s", a.SimulationBaseURL, run.RunID)
		raw, _, err := a.doJSON(ctx, http.MethodGet, url, nil)
		if err != nil {
			return SimulationRun{}, err
		}
		var cur SimulationRun
		if err := unwrapData(raw, &cur); err != nil {
			return SimulationRun{}, fmt.Errorf("decode run status: %w", err)
		}
		activity.RecordHeartbeat(ctx, cur.Status)
		switch cur.Status {
		case "succeeded", "completed":
			return cur, nil
		case "failed", "cancelled":
			return cur, fmt.Errorf("simulation run %s %s: %s", run.RunID, cur.Status, cur.Error)
		}
		select {
		case <-ctx.Done():
			return SimulationRun{}, ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
}

// EmitEvent publishes simulations.run.completed so the Node consumers can
// fan out reports/notifications exactly as they do for runner-executed runs.
func (a *Activities) EmitEvent(ctx context.Context, run SimulationRun) (string, error) {
	payload, err := json.Marshal(map[string]any{
		"source":      "temporal",
		"workflow":    "SimulationRunWorkflow",
		"run_id":      run.RunID,
		"emitted_at":  time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		return "", err
	}
	if err := a.produce(ctx, topicSimulationsRunCompleted, run.RunID, payload); err != nil {
		return "", err
	}
	return topicSimulationsRunCompleted, nil
}
