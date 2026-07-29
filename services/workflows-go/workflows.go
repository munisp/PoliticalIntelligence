// Temporal workflows (ADR-010, docs/TEMPORAL.md).
//
// IngestionPipelineWorkflow: RunConnector → ValidateBatch → LoadCanonical →
// RefreshAlerts. Each step is an activity over the existing Python ingestion
// service HTTP endpoints; Temporal supplies retries, durability and resume.
//
// SimulationRunWorkflow: SubmitRun → PollCompletion → EmitEvent over the
// existing simulation service, emitting simulations.run.completed for the
// Node consumers.
package main

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// Short transient retries for HTTP activities; long waits happen inside the
// polling activities (heartbeated), not in the retry policy.
var defaultActivityOptions = workflow.ActivityOptions{
	StartToCloseTimeout: 15 * time.Minute,
	HeartbeatTimeout:    30 * time.Second,
	RetryPolicy: &temporal.RetryPolicy{
		InitialInterval:    2 * time.Second,
		BackoffCoefficient: 2.0,
		MaximumInterval:    time.Minute,
		MaximumAttempts:    5,
	},
}

// IngestionPipelineWorkflow runs one connector end-to-end with durability.
func IngestionPipelineWorkflow(ctx workflow.Context, in IngestionInput) (IngestionJob, error) {
	ctx = workflow.WithActivityOptions(ctx, defaultActivityOptions)
	var a *Activities

	var run ConnectorRun
	if err := workflow.ExecuteActivity(ctx, a.RunConnector, in).Get(ctx, &run); err != nil {
		return IngestionJob{}, err
	}

	var job IngestionJob
	if err := workflow.ExecuteActivity(ctx, a.ValidateBatch, run).Get(ctx, &job); err != nil {
		return job, err
	}

	if err := workflow.ExecuteActivity(ctx, a.LoadCanonical, job).Get(ctx, &job); err != nil {
		return job, err
	}

	var topic string
	if err := workflow.ExecuteActivity(ctx, a.RefreshAlerts, job).Get(ctx, &topic); err != nil {
		return job, err
	}
	return job, nil
}

// SimulationRunWorkflow submits a scenario run and waits for completion
// durably, then emits simulations.run.completed.
func SimulationRunWorkflow(ctx workflow.Context, in SimulationInput) (SimulationRun, error) {
	ctx = workflow.WithActivityOptions(ctx, defaultActivityOptions)
	var a *Activities

	var run SimulationRun
	if err := workflow.ExecuteActivity(ctx, a.SubmitRun, in).Get(ctx, &run); err != nil {
		return run, err
	}

	if err := workflow.ExecuteActivity(ctx, a.PollCompletion, run).Get(ctx, &run); err != nil {
		return run, err
	}

	var topic string
	if err := workflow.ExecuteActivity(ctx, a.EmitEvent, run).Get(ctx, &topic); err != nil {
		return run, err
	}
	return run, nil
}
