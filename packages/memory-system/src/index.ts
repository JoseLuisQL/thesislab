// memory-system — checkpoint, feedback, and resume types

import type { ThesisRecordPayload, ThesisLifecycleState, ActiveWorkspacePayload } from '@thesis-research-os/thesis-registry';
import type { WorkflowTaskPayload, WorkflowTaskCheckpointPayload, WorkflowPackPayload } from '@thesis-research-os/workflow-orchestrator';
import type { ComplianceRunPayload, ComplianceIssuePayload } from '@thesis-research-os/university-policy-engine';
import type { AcademicQaRunPayload, AcademicQaIssuePayload } from '@thesis-research-os/academic-qa';

export type ThesisCheckpointPayload = {
  id: string;
  thesisId: string;
  label: string | null;
  note: string | null;
  scope: string;
  reason: string;
  snapshotPath: string | null;
  snapshotMetadata: Record<string, unknown> | null;
  createdBy: string;
  checkpointedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ThesisFeedbackPayload = {
  id: string;
  thesisId: string;
  sourceType: 'user' | 'system' | 'qa' | 'compliance';
  body: string;
  summary: string | null;
  recordedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateCheckpointInput = {
  label?: string | null;
  note?: string | null;
  scope: string;
  reason: string;
  snapshotPath?: string | null;
  snapshotMetadata?: Record<string, unknown> | null;
  createdBy: string;
  checkpointedAt?: string;
};

export type CreateFeedbackInput = {
  sourceType: 'user' | 'system' | 'qa' | 'compliance';
  body: string;
  summary?: string | null;
  recordedAt?: string;
};

export type ThesisResumePayload = {
  thesis: ThesisRecordPayload;
  state: ThesisLifecycleState;
  latestStatusAt: string;
  statusSummary: string;
  blockers: string[];
  nextAction: string;
  latestCheckpoint: ThesisCheckpointPayload | null;
  recentFeedback: ThesisFeedbackPayload[];
  activeTask: WorkflowTaskPayload | null;
  recentTaskCheckpoints: WorkflowTaskCheckpointPayload[];
  workflowPacks: WorkflowPackPayload[];
  activeWorkspace: ActiveWorkspacePayload | null;
  latestComplianceRun: ComplianceRunPayload | null;
  latestAcademicQaRun: AcademicQaRunPayload | null;
  recentComplianceFindings: ComplianceIssuePayload[];
  recentAcademicQaFindings: AcademicQaIssuePayload[];
};

export function generateNextAction(
  state: ThesisLifecycleState,
  nextStepSummary: string,
  hasBlockers: boolean,
): string {
  if (nextStepSummary.trim()) {
    return nextStepSummary;
  }

  if (hasBlockers) {
    return 'Resolve blockers before continuing.';
  }

  switch (state) {
    case 'draft':
      return 'Start intake to import thesis material.';
    case 'intake':
      return 'Review the intake report and normalize material.';
    case 'active':
      return 'Continue working on the active task.';
    case 'blocked':
      return 'Resolve blockers to resume work.';
    case 'review':
      return 'Complete the review cycle.';
    case 'completed':
      return 'Thesis is complete.';
    default:
      return 'Continue work on the thesis.';
  }
}
