// Temporal worker for the policy-twin platform (ADR-010, docs/TEMPORAL.md).
//
// Connects to the Temporal server (TEMPORAL_URL, default localhost:7233) and
// polls TEMPORAL_TASK_QUEUE (default "policy-twin") for the ingestion and
// simulation workflows. Build: `go build ./...`; run in compose via the
// `workflows` profile (workflows-worker service).
package main

import (
	"log"
	"os"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

func main() {
	addr := envOr("TEMPORAL_URL", "localhost:7233")
	namespace := envOr("TEMPORAL_NAMESPACE", "default")
	taskQueue := envOr("TEMPORAL_TASK_QUEUE", "policy-twin")

	c, err := client.Dial(client.Options{
		HostPort:  addr,
		Namespace: namespace,
		Logger:    nil,
	})
	if err != nil {
		log.Fatalf("temporal dial %s: %v", addr, err)
	}
	defer c.Close()

	activities := NewActivities()

	w := worker.New(c, taskQueue, worker.Options{})
	w.RegisterWorkflow(IngestionPipelineWorkflow)
	w.RegisterWorkflow(SimulationRunWorkflow)
	w.RegisterActivity(activities)

	log.Printf("worker listening: addr=%s namespace=%s task_queue=%s", addr, namespace, taskQueue)
	if err := w.Run(worker.InterruptCh()); err != nil {
		log.Fatalf("worker run: %v", err)
	}
	os.Exit(0)
}
