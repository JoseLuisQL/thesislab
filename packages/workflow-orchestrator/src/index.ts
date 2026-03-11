// workflow-orchestrator — task, pack, and step types

export type WorkflowStepStatus = 'pending' | 'in_progress' | 'blocked' | 'completed';

export type WorkflowTaskPayload = {
  id: string;
  thesisId: string;
  parentTaskId: string | null;
  title: string;
  intent: string;
  status: string;
  priority: number;
  sortOrder: number;
  dueAt: string | null;
  activeCheckpointId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateWorkflowTaskInput = {
  parentTaskId?: string | null;
  title: string;
  intent: string;
  status?: string;
  priority?: number;
  sortOrder?: number;
  dueAt?: string | null;
};

export type WorkflowTaskCheckpointPayload = {
  id: string;
  thesisId: string;
  taskId: string;
  label: string;
  summary: string;
  progressPercent: number;
  blocker: string | null;
  checkpointedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateWorkflowTaskCheckpointInput = {
  label: string;
  summary: string;
  progressPercent?: number;
  blocker?: string | null;
  checkpointedAt?: string;
};

export type WorkflowStepPayload = {
  id: string;
  thesisId: string;
  workflowPackId: string;
  title: string;
  description: string;
  status: WorkflowStepStatus;
  stepOrder: number;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowPackPayload = {
  id: string;
  thesisId: string;
  name: string;
  description: string;
  status: WorkflowStepStatus;
  currentStepId: string | null;
  progress: {
    totalSteps: number;
    completedSteps: number;
    blockedSteps: number;
    pendingSteps: number;
    inProgressSteps: number;
  };
  steps: WorkflowStepPayload[];
  createdAt: string;
  updatedAt: string;
};

export type CreateWorkflowPackInput = {
  name: string;
  description: string;
  status?: WorkflowStepStatus;
  currentStepId?: string | null;
  steps: Array<{
    title: string;
    description: string;
    status?: WorkflowStepStatus;
    stepOrder?: number;
  }>;
};

export type UpdateWorkflowPackInput = {
  status?: WorkflowStepStatus;
  currentStepId?: string | null;
  steps?: Array<{
    id: string;
    status?: WorkflowStepStatus;
    title?: string;
    description?: string;
    stepOrder?: number;
  }>;
};

// --- Errors ---

export class WorkflowTaskNotFoundError extends Error {
  constructor(public readonly thesisId: string, public readonly taskId: string) {
    super(`Workflow task ${taskId} was not found for thesis ${thesisId}.`);
    this.name = 'WorkflowTaskNotFoundError';
  }
}

export class WorkflowPackNotFoundError extends Error {
  constructor(public readonly thesisId: string, public readonly workflowPackId: string) {
    super(`Workflow pack ${workflowPackId} was not found for thesis ${thesisId}.`);
    this.name = 'WorkflowPackNotFoundError';
  }
}

// --- Pure functions ---

export function computePackProgress(steps: Array<{ status: WorkflowStepStatus }>) {
  return {
    totalSteps: steps.length,
    completedSteps: steps.filter((s) => s.status === 'completed').length,
    blockedSteps: steps.filter((s) => s.status === 'blocked').length,
    pendingSteps: steps.filter((s) => s.status === 'pending').length,
    inProgressSteps: steps.filter((s) => s.status === 'in_progress').length,
  };
}
