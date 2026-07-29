// Workflow unit tests using the Temporal testsuite (mocked activities).
//
// NOTE: the sandbox has no Go toolchain — run in CI:
//
//	cd services/workflows-go && go test ./...
//
// (tracked as a CI gate; see docs/TEMPORAL.md#ci).
package main

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/testsuite"
)

func TestIngestionPipelineWorkflow_HappyPath(t *testing.T) {
	ts := &testsuite.WorkflowTestSuite{}
	env := ts.NewTestWorkflowEnvironment()

	job := IngestionJob{JobID: "job-1", Status: "succeeded"}
	job.Summary.Contract.SchemaOK = true
	job.Summary.RecordsOut = 42
	job.Summary.Loader.Status = "ok"
	job.Summary.Loader.Applied = 42

	env.OnActivity("RunConnector", mock.Anything, IngestionInput{Connector: "worldbank", Jurisdiction: "ng"}).
		Return(ConnectorRun{JobID: "job-1", Status: "queued"}, nil)
	env.OnActivity("ValidateBatch", mock.Anything, ConnectorRun{JobID: "job-1", Status: "queued"}).
		Return(job, nil)
	env.OnActivity("LoadCanonical", mock.Anything, job).
		Return(job, nil)
	env.OnActivity("RefreshAlerts", mock.Anything, job).
		Return("features.materialized", nil)

	env.ExecuteWorkflow(IngestionPipelineWorkflow, IngestionInput{Connector: "worldbank", Jurisdiction: "ng"})

	assert.True(t, env.IsWorkflowCompleted())
	assert.NoError(t, env.GetWorkflowError())
	var out IngestionJob
	assert.NoError(t, env.GetWorkflowResult(&out))
	assert.Equal(t, 42, out.Summary.RecordsOut)
	env.AssertExpectations(t)
}

func TestIngestionPipelineWorkflow_ContractFailureStopsPipeline(t *testing.T) {
	ts := &testsuite.WorkflowTestSuite{}
	env := ts.NewTestWorkflowEnvironment()

	env.OnActivity("RunConnector", mock.Anything, mock.Anything).
		Return(ConnectorRun{JobID: "job-2"}, nil)
	env.OnActivity("ValidateBatch", mock.Anything, mock.Anything).
		Return(IngestionJob{JobID: "job-2", Status: "succeeded"}, errors.New("data contract failed for connector run job-2"))

	env.ExecuteWorkflow(IngestionPipelineWorkflow, IngestionInput{Connector: "nbs_bulletin", Jurisdiction: "ng"})

	assert.True(t, env.IsWorkflowCompleted())
	assert.Error(t, env.GetWorkflowError())
	// LoadCanonical / RefreshAlerts must NOT run after a contract failure.
	env.AssertNotCalled(t, "LoadCanonical", mock.Anything, mock.Anything)
	env.AssertNotCalled(t, "RefreshAlerts", mock.Anything, mock.Anything)
}

func TestSimulationRunWorkflow_HappyPath(t *testing.T) {
	ts := &testsuite.WorkflowTestSuite{}
	env := ts.NewTestWorkflowEnvironment()

	submitted := SimulationRun{RunID: "run-1", Status: "queued"}
	finished := SimulationRun{RunID: "run-1", Status: "succeeded"}

	env.OnActivity("SubmitRun", mock.Anything, SimulationInput{ScenarioID: "scn-1", Engine: "cge", Seed: 7, Horizon: 24}).
		Return(submitted, nil)
	env.OnActivity("PollCompletion", mock.Anything, submitted).
		Return(finished, nil)
	env.OnActivity("EmitEvent", mock.Anything, finished).
		Return("simulations.run.completed", nil)

	env.ExecuteWorkflow(SimulationRunWorkflow, SimulationInput{ScenarioID: "scn-1", Engine: "cge", Seed: 7, Horizon: 24})

	assert.True(t, env.IsWorkflowCompleted())
	assert.NoError(t, env.GetWorkflowError())
	var out SimulationRun
	assert.NoError(t, env.GetWorkflowResult(&out))
	assert.Equal(t, "run-1", out.RunID)
	env.AssertExpectations(t)
}

func TestSimulationRunWorkflow_FailedRunPropagates(t *testing.T) {
	ts := &testsuite.WorkflowTestSuite{}
	env := ts.NewTestWorkflowEnvironment()

	submitted := SimulationRun{RunID: "run-9", Status: "queued"}
	env.OnActivity("SubmitRun", mock.Anything, mock.Anything).Return(submitted, nil)
	env.OnActivity("PollCompletion", mock.Anything, submitted).
		Return(SimulationRun{RunID: "run-9", Status: "failed"}, errors.New("simulation run run-9 failed"))

	env.ExecuteWorkflow(SimulationRunWorkflow, SimulationInput{ScenarioID: "scn-9"})

	assert.True(t, env.IsWorkflowCompleted())
	assert.Error(t, env.GetWorkflowError())
	env.AssertNotCalled(t, "EmitEvent", mock.Anything, mock.Anything)
}
