export type HealthPayload = {
  mission: string;
  timestamp: string;
};

export function buildHealthPayload(mission: string): HealthPayload {
  return {
    mission,
    timestamp: new Date().toISOString(),
  };
}

export const webShellCards = [
  {
    title: 'Memory & resume',
    description:
      'Persist thesis identity, checkpoints, and continuation context for ongoing work.',
  },
  {
    title: 'Intake & normalization',
    description:
      'Ingest LaTeX, DOCX, and PDF material into a durable internal thesis model.',
  },
  {
    title: 'LaTeX workbench',
    description:
      'Run safe edits, checkpoints, and compile diagnostics within the workspace boundary.',
  },
  {
    title: 'Evidence & QA',
    description:
      'Trace claims to evidence, policy rules, and academic quality checks.',
  },
] as const;
