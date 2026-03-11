import { useQuery } from '@tanstack/react-query';

const API_BASE = '';

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`);
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

// --- Status ---

type CapabilityPayload = {
  ok: boolean;
  service: string;
  mission: string;
  timestamp: string;
  posture: { mode: string; state: string; summary: string };
  workflows: Array<{ key: string; label: string; state: string; summary: string; detail: string; kind: string; localFirst: boolean }>;
  integrations: Array<{ key: string; label: string; state: string; summary: string; detail: string; kind: string; optional: boolean }>;
};

export function useCapabilities() {
  return useQuery<CapabilityPayload>({
    queryKey: ['capabilities'],
    queryFn: () => fetchJson('/status/capabilities'),
    staleTime: 30_000,
  });
}

// --- Theses ---

type ThesisRecord = {
  id: string;
  title: string;
  slug: string;
  degreeProgram: string;
  institution: string;
  workspacePath: string;
  defaultLanguage: string;
  currentState: string;
  latestStatusAt: string;
  nextStepSummary: string;
  activeImportId: string | null;
  activeBuildRunId: string | null;
  createdAt: string;
  updatedAt: string;
};

type ThesisDetailPayload = {
  thesis: ThesisRecord;
  state: string;
  latestStatusAt: string;
  statusSummary: string;
  blockers: string[];
  nextStepSummary: string;
  checkpointCount: number;
  feedbackCount: number;
  latestCheckpointId: string | null;
  latestFeedbackId: string | null;
  activeWorkspace: unknown;
  transitions: unknown[];
};

export function useTheses() {
  return useQuery<{ theses: ThesisRecord[] }>({
    queryKey: ['theses'],
    queryFn: () => fetchJson('/theses'),
    staleTime: 10_000,
  });
}

export function useThesisDetail(thesisId: string | null) {
  return useQuery<{ thesis: ThesisDetailPayload }>({
    queryKey: ['thesis', thesisId],
    queryFn: () => fetchJson(`/theses/${thesisId}`),
    enabled: !!thesisId,
    staleTime: 10_000,
  });
}

// --- Resume ---

export function useThesisResume(thesisId: string | null) {
  return useQuery({
    queryKey: ['thesis-resume', thesisId],
    queryFn: () => fetchJson(`/theses/${thesisId}/resume`),
    enabled: !!thesisId,
    staleTime: 10_000,
  });
}

// --- Intake ---

export function useIntakeJobs(thesisId: string | null) {
  return useQuery({
    queryKey: ['intake-jobs', thesisId],
    queryFn: () => fetchJson(`/theses/${thesisId}/intake-jobs`),
    enabled: !!thesisId,
    staleTime: 10_000,
  });
}

// --- Sources ---

export function useSources(thesisId: string | null) {
  return useQuery({
    queryKey: ['sources', thesisId],
    queryFn: () => fetchJson(`/theses/${thesisId}/sources`),
    enabled: !!thesisId,
    staleTime: 10_000,
  });
}

// --- Evidence ---

export function useEvidence(thesisId: string | null) {
  return useQuery({
    queryKey: ['evidence', thesisId],
    queryFn: () => fetchJson(`/theses/${thesisId}/evidence`),
    enabled: !!thesisId,
    staleTime: 10_000,
  });
}

// --- Claims ---

export function useClaims(thesisId: string | null) {
  return useQuery({
    queryKey: ['claims', thesisId],
    queryFn: () => fetchJson(`/theses/${thesisId}/claims`),
    enabled: !!thesisId,
    staleTime: 10_000,
  });
}

// --- Compliance ---

export function useComplianceRuns(thesisId: string | null) {
  return useQuery({
    queryKey: ['compliance-runs', thesisId],
    queryFn: () => fetchJson(`/theses/${thesisId}/compliance-runs`),
    enabled: !!thesisId,
    staleTime: 10_000,
  });
}

// --- Academic QA ---

export function useAcademicQaRuns(thesisId: string | null) {
  return useQuery({
    queryKey: ['academic-qa-runs', thesisId],
    queryFn: () => fetchJson(`/theses/${thesisId}/academic-qa-runs`),
    enabled: !!thesisId,
    staleTime: 10_000,
  });
}

// --- Workflow ---

export function useWorkflowPacks(thesisId: string | null) {
  return useQuery({
    queryKey: ['workflow-packs', thesisId],
    queryFn: () => fetchJson(`/theses/${thesisId}/workflow-packs`),
    enabled: !!thesisId,
    staleTime: 10_000,
  });
}
