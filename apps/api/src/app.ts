import Fastify from 'fastify';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';

import { buildHealthPayload } from '@thesis-research-os/shared';
import { getDatabaseFilePath, runMigrations } from '@thesis-research-os/db';

import { buildLocalFirstStatusPayload, type LocalFirstStatusOptions } from './status.js';
import {
  type CreateWorkflowTaskInput,
  type CreateWorkflowPackInput,
  type CreateCheckpointInput,
  type CreateClaimInput,
  type CreateWorkflowTaskCheckpointInput,
  type CreateFeedbackInput,
  type CreateCitationInput,
  type CreateEvidenceFragmentInput,
  type CreateIntakeJobInput,
  type CreatePolicyProfileInput,
  type ResearchCaptureInput,
  type CreateZoteroMappingInput,
  type ListZoteroItemsInput,
  type UpdateOpenClawAssignmentInput,
  ClaimEvidenceScopeError,
  ClaimEvidenceLinkNotFoundError,
  ClaimNotFoundError,
  EvidenceContextScopeError,
  AcademicQaRunNotFoundError,
  EvidenceFragmentNotFoundError,
  IntakeBoundaryViolationError,
  IntakeJobNotFoundError,
  LatexBuildNotReadyError,
  LatexCheckpointRestoreError,
  LatexEditConflictError,
  LatexWorkspaceNotReadyError,
  SourceNotFoundError,
  PolicyProfileNotFoundError,
  type RegisterSourceInput,
  type LinkClaimEvidenceInput,
  SourceRegistrationConflictError,
  ThesisNotFoundError,
  type UpdateWorkflowPackInput,
  WorkflowPackNotFoundError,
  WorkflowTaskNotFoundError,
  ZoteroMappingNotFoundError,
  createThesisLifecycleService,
  type LatexEditRequest,
  type RefreshZoteroMappingInput,
  type TransitionThesisInput,
} from './thesis.js';

const createThesisSchema = z.object({
  title: z.string().trim().min(1),
  degreeProgram: z.string().trim().min(1),
  institution: z.string().trim().min(1),
  workspacePath: z.string().trim().min(1),
  policyProfileId: z.string().trim().min(1).nullable().optional(),
  openClawAgentId: z.string().trim().min(1).nullable().optional(),
  openClawSessionKey: z.string().trim().min(1).nullable().optional(),
  officialWorkspacePath: z.string().trim().min(1).nullable().optional(),
  officialEntrypoint: z.string().trim().min(1).nullable().optional(),
  defaultLanguage: z.string().trim().min(2).optional(),
});

const updateThesisSchema = createThesisSchema.partial().refine(
  (payload) => Object.keys(payload).length > 0,
  'At least one field must be provided.',
);

const openClawAssignmentSchema = z.object({
  agentId: z.string().trim().min(1).nullable().optional(),
  sessionKey: z.string().trim().min(1).nullable().optional(),
}).refine((payload) => Object.keys(payload).length > 0, 'At least one field must be provided.');

const transitionThesisSchema = z.object({
  state: z.enum(['draft', 'intake', 'active', 'blocked', 'review', 'completed']),
  source: z.string().trim().min(1),
  statusSummary: z.string().trim().min(1),
  blockers: z.array(z.string().trim().min(1)).optional(),
  nextStepSummary: z.string().trim().min(1).optional(),
});

const createCheckpointSchema = z.object({
  label: z.string().trim().min(1).nullable().optional(),
  note: z.string().trim().min(1).nullable().optional(),
  scope: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  snapshotPath: z.string().trim().min(1).nullable().optional(),
  createdBy: z.string().trim().min(1),
  checkpointedAt: z.string().datetime().optional(),
});

const createFeedbackSchema = z.object({
  sourceType: z.enum(['user', 'system', 'qa', 'compliance', 'advisor']),
  body: z.string().trim().min(1),
  summary: z.string().trim().min(1).nullable().optional(),
  recordedAt: z.string().datetime().optional(),
});

const createWorkflowTaskSchema = z.object({
  parentTaskId: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(1),
  intent: z.string().trim().min(1),
  status: z.string().trim().min(1).optional(),
  priority: z.number().int().optional(),
  sortOrder: z.number().int().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

const createWorkflowTaskCheckpointSchema = z.object({
  label: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  progressPercent: z.number().int().min(0).max(100).optional(),
  blocker: z.string().trim().min(1).nullable().optional(),
  checkpointedAt: z.string().datetime().optional(),
});

const workflowStepStatusSchema = z.enum(['pending', 'in_progress', 'blocked', 'completed']);

const createWorkflowPackSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  status: workflowStepStatusSchema.optional(),
  currentStepId: z.string().trim().min(1).nullable().optional(),
  steps: z.array(z.object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    status: workflowStepStatusSchema.optional(),
    stepOrder: z.number().int().optional(),
  })).min(1),
});

const updateWorkflowPackSchema = z.object({
  status: workflowStepStatusSchema.optional(),
  currentStepId: z.string().trim().min(1).nullable().optional(),
  steps: z.array(z.object({
    id: z.string().trim().min(1),
    status: workflowStepStatusSchema.optional(),
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    stepOrder: z.number().int().optional(),
  })).optional(),
}).refine((payload) => Object.keys(payload).length > 0, 'At least one field must be provided.');

const registerSourceSchema = z.object({
  sourceType: z.enum(['book', 'article', 'web', 'pdf', 'note', 'other']),
  title: z.string().trim().min(1),
  authors: z.array(z.string().trim().min(1)).optional(),
  publicationYear: z.number().int().nullable().optional(),
  locator: z.string().trim().min(1).nullable().optional(),
  ingest: z.object({
    ingestStatus: z.enum(['not_started', 'queued', 'succeeded', 'degraded', 'failed']).optional(),
    pdfText: z.string().nullable().optional(),
    pdfMetadata: z.record(z.string(), z.unknown()).nullable().optional(),
  }).optional(),
});

const createEvidenceFragmentSchema = z.object({
  sourceId: z.string().trim().min(1),
  locator: z.string().trim().min(1).nullable().optional(),
  snippet: z.string().trim().min(1),
  extractionMethod: z.string().trim().min(1),
  confidence: z.number().min(0).max(1).nullable().optional(),
  status: z.enum(['captured', 'needs_review', 'rejected']).optional(),
  provenance: z.record(z.string(), z.unknown()).nullable().optional(),
  normalizedNodeId: z.string().trim().min(1).nullable().optional(),
  taskId: z.string().trim().min(1).nullable().optional(),
});

const createClaimSchema = z.object({
  text: z.string().trim().min(1),
  status: z.enum(['draft', 'supported', 'contested', 'archived']).optional(),
  supportSummary: z.string().optional(),
  normalizedNodeId: z.string().trim().min(1).nullable().optional(),
});

const linkClaimEvidenceSchema = z.object({
  evidenceFragmentIds: z.array(z.string().trim().min(1)).min(1),
  rationale: z.string().trim().min(1),
});

const createIntakeJobSchema = z.object({
  importRootPath: z.string().trim().min(1),
});

const latexEditSchema = z.object({
  target: z.object({
    normalizedNodeId: z.string().trim().min(1).optional(),
    sourcePath: z.string().trim().min(1),
    title: z.string().trim().min(1),
    nodeType: z.enum(['chapter', 'section', 'subsection']),
    anchorStart: z.string().trim().min(1),
    anchorEnd: z.string().trim().min(1).nullable().optional(),
  }),
  replacement: z.string(),
  note: z.string().trim().min(1).nullable().optional(),
  createdBy: z.string().trim().min(1),
});

const latexBuildSchema = z.object({
  createdBy: z.string().trim().min(1),
});

const listZoteroCollectionsSchema = z.object({
  libraryKey: z.string().trim().min(1).optional(),
});

const listZoteroItemsSchema = z.object({
  libraryKey: z.string().trim().min(1).optional(),
  collectionKey: z.string().trim().min(1).optional(),
});

const searchZoteroItemsSchema = listZoteroItemsSchema.extend({
  q: z.string().trim().min(1),
});

const zoteroMappingScopeSchema = z.enum(['thesis', 'chapter']);

const createZoteroMappingSchema = z.object({
  scope: zoteroMappingScopeSchema,
  normalizedNodeId: z.string().trim().min(1).nullable().optional(),
  libraryId: z.string().trim().min(1),
  collectionKey: z.string().trim().min(1).nullable().optional(),
  itemKey: z.string().trim().min(1).nullable().optional(),
});

const listZoteroMappingsSchema = z.object({
  scope: zoteroMappingScopeSchema.optional(),
  normalizedNodeId: z.string().trim().min(1).optional(),
});

const refreshZoteroMappingSchema = z.object({
  libraryId: z.string().trim().min(1).optional(),
  collectionKey: z.string().trim().min(1).nullable().optional(),
  itemKey: z.string().trim().min(1).nullable().optional(),
});

const createCitationSchema = z.object({
  sourceId: z.string().trim().min(1).nullable().optional(),
  zoteroMappingId: z.string().trim().min(1).nullable().optional(),
  normalizedNodeId: z.string().trim().min(1).nullable().optional(),
  claimId: z.string().trim().min(1).nullable().optional(),
  citationKey: z.string().trim().min(1),
  locator: z.string().trim().min(1).nullable().optional(),
  style: z.string().trim().min(1).optional(),
  status: z.enum(['draft', 'linked', 'validated']).optional(),
});

const researchSearchSchema = z.object({
  query: z.string().trim().min(1),
});

const researchFetchSchema = z.object({
  url: z.string().url(),
});

const researchCaptureSchema = z.object({
  source: registerSourceSchema,
  evidence: createEvidenceFragmentSchema.omit({ sourceId: true }).optional(),
  claim: createClaimSchema.optional(),
  citation: createCitationSchema.omit({ sourceId: true, claimId: true }).optional(),
});

const mcpToolCallSchema = z.object({
  toolName: z.string().trim().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
});

const policyRuleDefinitionSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  category: z.enum(['structure', 'metadata']),
  severity: z.enum(['warning', 'violation']),
  remediation: z.string().trim().min(1),
  requiredSectionTitle: z.string().trim().min(1).optional(),
  minimumDocumentChildren: z.number().int().positive().optional(),
});

const createPolicyProfileSchema = z.object({
  id: z.string().trim().min(1).optional(),
  institution: z.string().trim().min(1),
  faculty: z.string().trim().min(1),
  version: z.string().trim().min(1),
  title: z.string().trim().min(1),
  requiredSections: z.array(z.string().trim().min(1)).min(1),
  rules: z.array(policyRuleDefinitionSchema).min(1),
  isActive: z.boolean().optional(),
});

export function resolveRuntimeDatabaseUrl() {
  const databaseFilePath = getDatabaseFilePath(process.env.DATABASE_URL);
  return `file:${databaseFilePath}`;
}

export function createApp() {
  const testDatabaseUrl = resolveRuntimeDatabaseUrl();
  const app = Fastify({ logger: !process.env.VITEST });
  let schemaReady: Promise<void> | null = null;
  let thesisLifecycle: ReturnType<typeof createThesisLifecycleService> | null = null;

  const getThesisLifecycle = async () => {
    schemaReady ??= ensureDatabaseSchema(testDatabaseUrl);
    await schemaReady;

    if (!thesisLifecycle) {
      thesisLifecycle = createThesisLifecycleService(testDatabaseUrl);
    }

    return thesisLifecycle;
  };

  app.addHook('onClose', async () => {
    thesisLifecycle?.close();
  });


  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ThesisNotFoundError) {
      return reply.status(404).send({
        ok: false,
        code: 'THESIS_NOT_FOUND',
        message: error.message,
      });
    }

    if (error instanceof IntakeJobNotFoundError) {
      return reply.status(404).send({
        ok: false,
        code: 'INTAKE_JOB_NOT_FOUND',
        message: error.message,
      });
    }

    if (error instanceof SourceNotFoundError) {
      return reply.status(404).send({
        ok: false,
        code: 'SOURCE_NOT_FOUND',
        message: error.message,
        thesisId: error.thesisId,
        sourceId: error.sourceId,
      });
    }

    if (error instanceof ZoteroMappingNotFoundError) {
      return reply.status(404).send({
        ok: false,
        code: 'ZOTERO_MAPPING_NOT_FOUND',
        message: error.message,
        thesisId: error.thesisId,
        mappingId: error.mappingId,
      });
    }

    if (error instanceof PolicyProfileNotFoundError) {
      return reply.status(404).send({
        ok: false,
        code: 'POLICY_PROFILE_NOT_FOUND',
        message: error.message,
      });
    }

    if (error instanceof EvidenceFragmentNotFoundError) {
      return reply.status(404).send({
        ok: false,
        code: 'EVIDENCE_FRAGMENT_NOT_FOUND',
        message: error.message,
        thesisId: error.thesisId,
        evidenceFragmentId: error.evidenceFragmentId,
      });
    }

    if (error instanceof ClaimNotFoundError) {
      return reply.status(404).send({
        ok: false,
        code: 'CLAIM_NOT_FOUND',
        message: error.message,
        thesisId: error.thesisId,
        claimId: error.claimId,
      });
    }

    if (error instanceof AcademicQaRunNotFoundError) {
      return reply.status(404).send({
        ok: false,
        code: 'ACADEMIC_QA_RUN_NOT_FOUND',
        message: error.message,
        thesisId: error.thesisId,
        academicQaRunId: error.academicQaRunId,
      });
    }

    if (error instanceof ClaimEvidenceLinkNotFoundError) {
      return reply.status(404).send({
        ok: false,
        code: 'CLAIM_EVIDENCE_LINK_NOT_FOUND',
        message: error.message,
        thesisId: error.thesisId,
        claimId: error.claimId,
        evidenceFragmentId: error.evidenceFragmentId,
      });
    }

    if (error instanceof WorkflowTaskNotFoundError) {
      return reply.status(404).send({
        ok: false,
        code: 'WORKFLOW_TASK_NOT_FOUND',
        message: error.message,
        thesisId: error.thesisId,
        taskId: error.taskId,
      });
    }

    if (error instanceof WorkflowPackNotFoundError) {
      return reply.status(404).send({
        ok: false,
        code: 'WORKFLOW_PACK_NOT_FOUND',
        message: error.message,
        thesisId: error.thesisId,
        workflowPackId: error.workflowPackId,
      });
    }

    if (error instanceof SourceRegistrationConflictError || error instanceof EvidenceContextScopeError || error instanceof ClaimEvidenceScopeError) {
      return reply.status(409).send({
        ok: false,
        code: error instanceof SourceRegistrationConflictError
          ? 'SOURCE_REGISTRATION_CONFLICT'
          : error instanceof ClaimEvidenceScopeError
            ? 'CLAIM_EVIDENCE_SCOPE_ERROR'
            : 'EVIDENCE_CONTEXT_SCOPE_ERROR',
        message: error.message,
        thesisId: error.thesisId,
      });
    }

    if (error instanceof IntakeBoundaryViolationError) {
      return reply.status(400).send({
        ok: false,
        code: 'INTAKE_BOUNDARY_VIOLATION',
        message: error.message,
        thesisId: error.thesisId,
        importRootPath: error.importRootPath,
        resolvedPath: error.resolvedPath,
      });
    }

    if (error instanceof LatexWorkspaceNotReadyError) {
      return reply.status(409).send({
        ok: false,
        code: 'LATEX_WORKSPACE_NOT_READY',
        message: error.message,
        thesisId: error.thesisId,
      });
    }

    if (error instanceof LatexEditConflictError) {
      return reply.status(409).send({
        ok: false,
        code: 'LATEX_EDIT_TARGET_CONFLICT',
        message: error.message,
        thesisId: error.thesisId,
        reasons: error.reasons,
        structure: error.snapshot,
      });
    }

    if (error instanceof LatexCheckpointRestoreError) {
      return reply.status(400).send({
        ok: false,
        code: 'LATEX_CHECKPOINT_RESTORE_ERROR',
        message: error.message,
        thesisId: error.thesisId,
        checkpointId: error.checkpointId,
      });
    }

    if (error instanceof LatexBuildNotReadyError) {
      return reply.status(409).send({
        ok: false,
        code: 'LATEX_BUILD_NOT_READY',
        message: error.message,
        thesisId: error.thesisId,
      });
    }

    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Request payload failed validation.',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    throw error;
  });

  app.get('/health', async () => ({
    ok: true,
    service: 'api',
    ...buildHealthPayload('foundation-platform'),
  }));

  app.get('/status/capabilities', async () => buildLocalFirstStatusPayload());

  app.get('/openclaw/status', async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const status = await (await getThesisLifecycle()).service.getOpenClawStatus();
    return { ok: true, status };
  });

  app.get('/openclaw/agents', async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const status = await (await getThesisLifecycle()).service.getOpenClawStatus();
    return { ok: true, agents: status.agents };
  });

  app.post('/mcp/tools/call', async (request, reply) => {
    const payload = mcpToolCallSchema.parse(request.body ?? {});
    const args = payload.args ?? {};

    if (payload.toolName === 'zotero.list_libraries') {
      const { createMcpBridgeConnector } = await import('@thesis-research-os/zotero-bridge');
      const connector = createMcpBridgeConnector();
      const libraries = await Promise.resolve(connector.listLibraries());
      return reply.status(200).send({ libraries });
    }

    if (payload.toolName === 'zotero.list_collections') {
      const { createMcpBridgeConnector } = await import('@thesis-research-os/zotero-bridge');
      const connector = createMcpBridgeConnector();
      const collections = await Promise.resolve(connector.listCollections({
        libraryKey: typeof args.libraryKey === 'string' ? args.libraryKey : null,
      }));
      return reply.status(200).send({ collections });
    }

    if (payload.toolName === 'zotero.list_items') {
      const { createMcpBridgeConnector } = await import('@thesis-research-os/zotero-bridge');
      const connector = createMcpBridgeConnector();
      const items = await Promise.resolve(connector.listItems({
        libraryKey: typeof args.libraryKey === 'string' ? args.libraryKey : null,
        collectionKey: typeof args.collectionKey === 'string' ? args.collectionKey : null,
      }));
      return reply.status(200).send({ items });
    }

    if (payload.toolName === 'zotero.search_items') {
      const { createMcpBridgeConnector } = await import('@thesis-research-os/zotero-bridge');
      const connector = createMcpBridgeConnector();
      const items = await Promise.resolve(connector.searchItems({
        query: typeof args.query === 'string' ? args.query : '',
        libraryKey: typeof args.libraryKey === 'string' ? args.libraryKey : null,
        collectionKey: typeof args.collectionKey === 'string' ? args.collectionKey : null,
      }));
      return reply.status(200).send({ items });
    }

    if (payload.toolName === 'zotero.resolve_mapping') {
      const { createMcpBridgeConnector } = await import('@thesis-research-os/zotero-bridge');
      const connector = createMcpBridgeConnector();
      const [libraries, collections, items] = await Promise.all([
        Promise.resolve(connector.listLibraries()),
        Promise.resolve(connector.listCollections({
          libraryKey: typeof args.libraryId === 'string' ? args.libraryId : null,
        })),
        Promise.resolve(connector.listItems({
          libraryKey: typeof args.libraryId === 'string' ? args.libraryId : null,
          collectionKey: null,
        })),
      ]);

      const library = libraries.find((entry) => entry.id === args.libraryId || entry.key === args.libraryId) ?? null;
      const collection = typeof args.collectionKey === 'string'
        ? collections.find((entry) => entry.key === args.collectionKey)
        : null;
      const item = typeof args.itemKey === 'string'
        ? items.find((entry) => entry.key === args.itemKey)
        : null;
      const missing = [
        library ? null : 'library',
        typeof args.collectionKey === 'string' && !collection ? 'collection' : null,
        typeof args.itemKey === 'string' && !item ? 'item' : null,
      ].filter((value): value is string => value !== null);

      return reply.status(200).send({
        connectorStatus: missing.length === 0 ? 'ready' : 'degraded',
        normalizedData: {
          library,
          collection: collection ?? null,
          item: item ?? null,
          connectorMessage: missing.length === 0 ? null : `Zotero connector could not resolve ${missing.join(', ')} for the requested mapping refresh.`,
          connectorCode: missing.length === 0 ? null : 'ZOTERO_CONNECTOR_RESOLUTION_FAILED',
        },
      });
    }

    return reply.status(404).send({
      ok: false,
      code: 'MCP_TOOL_NOT_FOUND',
      message: `Unsupported MCP tool ${payload.toolName}.`,
    });
  });

  app.get('/theses/:thesisId/status/capabilities', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const thesisId = (request.params as { thesisId: string }).thesisId;
    const lifecycle = await getThesisLifecycle();
    const [detail, resume] = await Promise.all([
      lifecycle.service.getThesisDetail(thesisId),
      lifecycle.service.getResume(thesisId),
    ]);

    const workflowOverrides: LocalFirstStatusOptions['workflowOverrides'] = {
      create: {
        key: 'create',
        state: 'available',
        summary: `Ready for thesis ${detail.thesis.title}`,
        detail: 'Local thesis creation remains available even while optional integrations are degraded.',
      },
      intake: detail.activeWorkspace
        ? {
            key: 'intake',
            state: 'available',
            summary: `Active ${detail.activeWorkspace.detectedFormat.toUpperCase()} workspace available`,
            detail: `Local intake completed for ${detail.activeWorkspace.intakeJobId} with ${detail.activeWorkspace.nodeCount} normalized nodes and no required connector dependency.`,
          }
        : {
            key: 'intake',
            state: 'available',
            summary: 'Ready for first local import',
            detail: 'The thesis can run intake locally without optional connectors; no active imported workspace exists yet.',
          },
      resume: {
        key: 'resume',
        state: 'available',
        summary: resume.latestCheckpoint
          ? `Resume from checkpoint ${resume.latestCheckpoint.id}`
          : 'Resume baseline available',
        detail: `Continuation guidance stays local-first with ${resume.recentFeedback.length} recent feedback entries and ${resume.blockers.length} explicit blockers.`,
      },
      latex: detail.activeWorkspace?.detectedFormat === 'latex'
        ? {
            key: 'latex',
            state: 'available',
            summary: detail.activeWorkspace.latestBuildRunId
              ? `LaTeX workspace ready with build ${detail.activeWorkspace.latestBuildRunId}`
              : 'LaTeX workspace ready for local edits/builds',
            detail: `LaTeX operations run against the active workspace entrypoint ${detail.activeWorkspace.entrypoint ?? 'main.tex'} without depending on optional connectors.`,
          }
        : {
            key: 'latex',
            state: 'available',
            summary: 'Ready when a LaTeX workspace is active',
            detail: 'The local LaTeX workbench remains available, but this thesis does not currently have an active LaTeX workspace.',
          },
      qa: {
        key: 'qa',
        state: 'available',
        summary: resume.latestAcademicQaRun || resume.latestComplianceRun
          ? 'Latest local QA history available'
          : 'Ready for first local QA run',
        detail: `Academic QA and compliance remain usable locally; this thesis currently has ${resume.recentAcademicQaFindings.length} recent QA findings and ${resume.recentComplianceFindings.length} recent compliance findings.`,
      },
    };

    return buildLocalFirstStatusPayload({
      mission: 'hardening',
      workflowOverrides,
    });
  });

  app.get('/zotero/libraries', async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const libraries = await (await getThesisLifecycle()).service.listZoteroLibraries();

    return { ok: true, libraries };
  });

  app.get('/zotero/collections', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const query = listZoteroCollectionsSchema.parse(request.query ?? {});
    const collections = await (await getThesisLifecycle()).service.listZoteroCollections(query.libraryKey ?? null);

    return { ok: true, collections };
  });

  app.get('/zotero/items', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const query = listZoteroItemsSchema.parse(request.query ?? {}) as ListZoteroItemsInput;
    const items = await (await getThesisLifecycle()).service.listZoteroItems(query);

    return { ok: true, items };
  });

  app.get('/zotero/items/search', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const query = searchZoteroItemsSchema.parse(request.query ?? {});
    const items = await (await getThesisLifecycle()).service.searchZoteroItems({
      query: query.q,
      libraryKey: query.libraryKey ?? null,
      collectionKey: query.collectionKey ?? null,
    });

    return { ok: true, items };
  });

  // --- Zotero BibTeX Export ---

  app.post('/theses/:thesisId/zotero/export-bib', async (request, reply) => {
    const { thesisId } = request.params as { thesisId: string };
    const body = (request.body ?? {}) as { libraryKey?: string; collectionKey?: string; filename?: string };
    const filename = body.filename?.trim() || 'references.bib';

    process.env.DATABASE_URL = testDatabaseUrl;
    const detail = await (await getThesisLifecycle()).service.getThesisDetail(thesisId);

    // Fetch items from Zotero connector
    const items = await (await getThesisLifecycle()).service.listZoteroItems({
      libraryKey: body.libraryKey,
      collectionKey: body.collectionKey,
    });

    // Convert to BibTeX
    const { exportCollectionToBibtex } = await import('@thesis-research-os/zotero-bridge');
    const bibContent = exportCollectionToBibtex(items);

    // Write to workspace if thesis has one
    let writtenTo: string | null = null;

    if (detail.thesis.workspacePath) {
      const bibPath = path.join(detail.thesis.workspacePath, filename);
      fs.mkdirSync(path.dirname(bibPath), { recursive: true });
      fs.writeFileSync(bibPath, bibContent, 'utf8');
      writtenTo = bibPath;
    }

    return reply.status(201).send({
      ok: true,
      itemCount: items.length,
      filename,
      writtenTo,
      bibContent,
    });
  });

  app.post('/theses/:thesisId/zotero/sync-bibliography', async (request, reply) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const sync = await (await getThesisLifecycle()).service.syncZoteroBibliography(
      (request.params as { thesisId: string }).thesisId,
    );

    return reply.status(201).send({ ok: true, sync });
  });

  app.get('/policy-profiles/active', async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const policyProfile = await (await getThesisLifecycle()).service.getActivePolicyProfile();

    return { ok: true, policyProfile };
  });

  app.get('/policy-profiles', async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const policyProfiles = await (await getThesisLifecycle()).service.listPolicyProfiles();

    return { ok: true, policyProfiles };
  });

  app.post('/policy-profiles', async (request, reply) => {
    const payload = createPolicyProfileSchema.parse(request.body) as CreatePolicyProfileInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const policyProfile = await (await getThesisLifecycle()).service.createPolicyProfile(payload);

    return reply.status(201).send({ ok: true, policyProfile });
  });

  app.post('/theses/:thesisId/zotero-mappings', async (request, reply) => {
    const payload = createZoteroMappingSchema.parse(request.body) as CreateZoteroMappingInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const mapping = await (await getThesisLifecycle()).service.createZoteroMapping(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return reply.status(201).send({ ok: true, mapping });
  });

  app.get('/theses/:thesisId/zotero-mappings', async (request) => {
    const query = listZoteroMappingsSchema.parse(request.query ?? {});
    process.env.DATABASE_URL = testDatabaseUrl;
    const mappings = await (await getThesisLifecycle()).service.listZoteroMappings(
      (request.params as { thesisId: string }).thesisId,
      query.scope,
      query.normalizedNodeId,
    );

    return { ok: true, mappings };
  });

  app.get('/theses/:thesisId/zotero-mappings/:mappingId', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; mappingId: string };
    const mapping = await (await getThesisLifecycle()).service.getZoteroMapping(params.thesisId, params.mappingId);

    return { ok: true, mapping };
  });

  app.post('/theses/:thesisId/zotero-mappings/:mappingId/refresh', async (request) => {
    const payload = refreshZoteroMappingSchema.parse(request.body ?? {}) as RefreshZoteroMappingInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; mappingId: string };
    const mapping = await (await getThesisLifecycle()).service.refreshZoteroMapping(
      params.thesisId,
      params.mappingId,
      payload,
    );

    return { ok: true, mapping };
  });

  app.get('/theses', async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const theses = await (await getThesisLifecycle()).service.listTheses();

    return { ok: true, theses };
  });

  app.post('/theses', async (request, reply) => {
    const payload = createThesisSchema.parse(request.body);
    process.env.DATABASE_URL = testDatabaseUrl;
    const thesis = await (await getThesisLifecycle()).service.createThesis(payload);

    return reply.status(201).send({ ok: true, thesis });
  });

  app.get('/theses/:thesisId', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const thesis = await (await getThesisLifecycle()).service.getThesisDetail(
      (request.params as { thesisId: string }).thesisId,
    );

    return { ok: true, thesis };
  });

  app.patch('/theses/:thesisId', async (request) => {
    const payload = updateThesisSchema.parse(request.body);
    process.env.DATABASE_URL = testDatabaseUrl;
    const thesis = await (await getThesisLifecycle()).service.updateThesis(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return { ok: true, thesis };
  });

  app.get('/theses/:thesisId/openclaw-assignment', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const assignment = await (await getThesisLifecycle()).service.getOpenClawAssignment(
      (request.params as { thesisId: string }).thesisId,
    );

    return { ok: true, assignment };
  });

  app.patch('/theses/:thesisId/openclaw-assignment', async (request) => {
    const payload = openClawAssignmentSchema.parse(request.body ?? {}) as UpdateOpenClawAssignmentInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const assignment = await (await getThesisLifecycle()).service.updateOpenClawAssignment(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return { ok: true, assignment };
  });

  app.post('/theses/:thesisId/state', async (request) => {
    const payload = transitionThesisSchema.parse(request.body) as TransitionThesisInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const thesis = await (await getThesisLifecycle()).service.transitionThesis(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return { ok: true, thesis };
  });

  app.post('/theses/:thesisId/checkpoints', async (request, reply) => {
    const payload = createCheckpointSchema.parse(request.body) as CreateCheckpointInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const checkpoint = await (await getThesisLifecycle()).service.createCheckpoint(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return reply.status(201).send({ ok: true, checkpoint });
  });

  app.get('/theses/:thesisId/checkpoints', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const checkpoints = await (await getThesisLifecycle()).service.listCheckpoints(
      (request.params as { thesisId: string }).thesisId,
    );

    return { ok: true, checkpoints };
  });

  app.post('/theses/:thesisId/feedback', async (request, reply) => {
    const payload = createFeedbackSchema.parse(request.body) as CreateFeedbackInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const feedback = await (await getThesisLifecycle()).service.createFeedback(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return reply.status(201).send({ ok: true, feedback });
  });

  app.get('/theses/:thesisId/feedback', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const feedback = await (await getThesisLifecycle()).service.listFeedback(
      (request.params as { thesisId: string }).thesisId,
    );

    return { ok: true, feedback };
  });

  app.post('/theses/:thesisId/tasks', async (request, reply) => {
    const payload = createWorkflowTaskSchema.parse(request.body) as CreateWorkflowTaskInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const task = await (await getThesisLifecycle()).service.createWorkflowTask(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return reply.status(201).send({ ok: true, task });
  });

  app.get('/theses/:thesisId/tasks', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const tasks = await (await getThesisLifecycle()).service.listWorkflowTasks(
      (request.params as { thesisId: string }).thesisId,
    );

    return { ok: true, tasks };
  });

  app.get('/theses/:thesisId/tasks/:taskId', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; taskId: string };
    const task = await (await getThesisLifecycle()).service.getWorkflowTask(params.thesisId, params.taskId);

    return { ok: true, task };
  });

  app.post('/theses/:thesisId/tasks/:taskId/checkpoints', async (request, reply) => {
    const payload = createWorkflowTaskCheckpointSchema.parse(request.body) as CreateWorkflowTaskCheckpointInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; taskId: string };
    const checkpoint = await (await getThesisLifecycle()).service.createWorkflowTaskCheckpoint(
      params.thesisId,
      params.taskId,
      payload,
    );

    return reply.status(201).send({ ok: true, checkpoint });
  });

  app.get('/theses/:thesisId/tasks/:taskId/checkpoints', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; taskId: string };
    const checkpoints = await (await getThesisLifecycle()).service.listWorkflowTaskCheckpoints(
      params.thesisId,
      params.taskId,
    );

    return { ok: true, checkpoints };
  });

  app.post('/theses/:thesisId/workflow-packs', async (request, reply) => {
    const payload = createWorkflowPackSchema.parse(request.body) as CreateWorkflowPackInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const workflowPack = await (await getThesisLifecycle()).service.createWorkflowPack(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return reply.status(201).send({ ok: true, workflowPack });
  });

  app.get('/theses/:thesisId/workflow-packs', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const workflowPacks = await (await getThesisLifecycle()).service.listWorkflowPacks(
      (request.params as { thesisId: string }).thesisId,
    );

    return { ok: true, workflowPacks };
  });

  app.get('/theses/:thesisId/workflow-packs/:workflowPackId', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; workflowPackId: string };
    const workflowPack = await (await getThesisLifecycle()).service.getWorkflowPack(
      params.thesisId,
      params.workflowPackId,
    );

    return { ok: true, workflowPack };
  });

  app.patch('/theses/:thesisId/workflow-packs/:workflowPackId', async (request) => {
    const payload = updateWorkflowPackSchema.parse(request.body) as UpdateWorkflowPackInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; workflowPackId: string };
    const workflowPack = await (await getThesisLifecycle()).service.updateWorkflowPack(
      params.thesisId,
      params.workflowPackId,
      payload,
    );

    return { ok: true, workflowPack };
  });

  app.patch('/theses/:thesisId/workflow-packs/:workflowPackId/openclaw-assignment', async (request) => {
    const payload = openClawAssignmentSchema.parse(request.body ?? {}) as UpdateOpenClawAssignmentInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; workflowPackId: string };
    const workflowPack = await (await getThesisLifecycle()).service.updateWorkflowPackOpenClawAssignment(
      params.thesisId,
      params.workflowPackId,
      payload,
    );

    return { ok: true, workflowPack };
  });

  app.get('/theses/:thesisId/evidence-context-setup', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const setup = await (await getThesisLifecycle()).service.getEvidenceContextSetup(
      (request.params as { thesisId: string }).thesisId,
    );

    return { ok: true, setup };
  });

  app.post('/theses/:thesisId/sources', async (request, reply) => {
    const payload = registerSourceSchema.parse(request.body) as RegisterSourceInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const result = await (await getThesisLifecycle()).service.registerSource(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return reply.status(result.duplicate ? 200 : 201).send({ ok: true, source: result.source, duplicate: result.duplicate });
  });

  app.post('/theses/:thesisId/research/search', async (request, reply) => {
    const payload = researchSearchSchema.parse(request.body);
    process.env.DATABASE_URL = testDatabaseUrl;
    const results = await (await getThesisLifecycle()).service.searchResearch(
      (request.params as { thesisId: string }).thesisId,
      payload.query,
    );

    return reply.status(200).send({ ok: true, results });
  });

  app.post('/theses/:thesisId/research/fetch', async (request, reply) => {
    const payload = researchFetchSchema.parse(request.body);
    process.env.DATABASE_URL = testDatabaseUrl;
    const page = await (await getThesisLifecycle()).service.fetchResearchPage(
      (request.params as { thesisId: string }).thesisId,
      payload.url,
    );

    return reply.status(200).send({ ok: true, page });
  });

  app.post('/theses/:thesisId/research/capture', async (request, reply) => {
    const payload = researchCaptureSchema.parse(request.body) as ResearchCaptureInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const captured = await (await getThesisLifecycle()).service.captureResearchArtifact(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return reply.status(201).send({ ok: true, captured });
  });

  app.get('/theses/:thesisId/sources', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string };
    const query = (request.query as { q?: string } | undefined)?.q ?? null;
    const sources = await (await getThesisLifecycle()).service.listSources(params.thesisId, { query });

    return { ok: true, sources };
  });

  app.get('/theses/:thesisId/sources/:sourceId', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; sourceId: string };
    const source = await (await getThesisLifecycle()).service.getSource(params.thesisId, params.sourceId);

    return { ok: true, source };
  });

  app.post('/theses/:thesisId/citations', async (request, reply) => {
    const payload = createCitationSchema.parse(request.body) as CreateCitationInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const citation = await (await getThesisLifecycle()).service.createCitation(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return reply.status(201).send({ ok: true, citation });
  });

  app.get('/theses/:thesisId/citations', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const citations = await (await getThesisLifecycle()).service.listCitations(
      (request.params as { thesisId: string }).thesisId,
    );

    return { ok: true, citations };
  });

  app.post('/theses/:thesisId/evidence-fragments', async (request, reply) => {
    const payload = createEvidenceFragmentSchema.parse(request.body) as CreateEvidenceFragmentInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const evidenceFragment = await (await getThesisLifecycle()).service.createEvidenceFragment(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return reply.status(201).send({ ok: true, evidenceFragment });
  });

  app.post('/theses/:thesisId/evidence', async (request, reply) => {
    const payload = createEvidenceFragmentSchema.parse(request.body) as CreateEvidenceFragmentInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const evidenceFragment = await (await getThesisLifecycle()).service.createEvidenceFragment(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return reply.status(201).send({ ok: true, evidenceFragment });
  });

  app.get('/theses/:thesisId/evidence-fragments', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const evidenceFragments = await (await getThesisLifecycle()).service.listEvidenceFragments(
      (request.params as { thesisId: string }).thesisId,
    );

    return { ok: true, evidenceFragments, fragments: evidenceFragments };
  });

  app.get('/theses/:thesisId/evidence', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const evidenceFragments = await (await getThesisLifecycle()).service.listEvidenceFragments(
      (request.params as { thesisId: string }).thesisId,
    );

    return { ok: true, evidenceFragments, fragments: evidenceFragments };
  });

  app.get('/theses/:thesisId/evidence-fragments/:evidenceFragmentId', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; evidenceFragmentId: string };
    const evidenceFragment = await (await getThesisLifecycle()).service.getEvidenceFragment(
      params.thesisId,
      params.evidenceFragmentId,
    );

    return { ok: true, evidenceFragment };
  });

  app.post('/theses/:thesisId/claims', async (request, reply) => {
    const payload = createClaimSchema.parse(request.body) as CreateClaimInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const claim = await (await getThesisLifecycle()).service.createClaim(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return reply.status(201).send({ ok: true, claim });
  });

  app.get('/theses/:thesisId/claims', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const claims = await (await getThesisLifecycle()).service.listClaims(
      (request.params as { thesisId: string }).thesisId,
    );

    return { ok: true, claims };
  });

  app.get('/theses/:thesisId/claims/:claimId', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; claimId: string };
    const claim = await (await getThesisLifecycle()).service.getClaim(params.thesisId, params.claimId);

    return { ok: true, claim };
  });

  app.post('/theses/:thesisId/claims/:claimId/evidence-links', async (request) => {
    const payload = linkClaimEvidenceSchema.parse(request.body) as LinkClaimEvidenceInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; claimId: string };
    const claim = await (await getThesisLifecycle()).service.linkClaimToEvidence(params.thesisId, params.claimId, payload);

    return { ok: true, claim };
  });

  app.delete('/theses/:thesisId/claims/:claimId/evidence-links/:evidenceFragmentId', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; claimId: string; evidenceFragmentId: string };
    const claim = await (await getThesisLifecycle()).service.unlinkClaimEvidence(
      params.thesisId,
      params.claimId,
      params.evidenceFragmentId,
    );

    return { ok: true, claim };
  });

  app.get('/theses/:thesisId/resume', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const resume = await (await getThesisLifecycle()).service.getResume(
      (request.params as { thesisId: string }).thesisId,
    );

    return { ok: true, resume };
  });

  app.post('/theses/:thesisId/compliance-runs', async (request, reply) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const complianceRun = await (await getThesisLifecycle()).service.createComplianceRun(
      (request.params as { thesisId: string }).thesisId,
    );

    return reply.status(201).send({ ok: true, complianceRun });
  });

  app.post('/theses/:thesisId/academic-qa-runs', async (request, reply) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const academicQaRun = await (await getThesisLifecycle()).service.createAcademicQaRun(
      (request.params as { thesisId: string }).thesisId,
    );

    return reply.status(201).send({ ok: true, academicQaRun });
  });

  app.get('/theses/:thesisId/compliance-runs', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const complianceRuns = await (await getThesisLifecycle()).service.listComplianceRuns(
      (request.params as { thesisId: string }).thesisId,
    );

    return { ok: true, complianceRuns };
  });

  app.get('/theses/:thesisId/academic-qa-runs', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const academicQaRuns = await (await getThesisLifecycle()).service.listAcademicQaRuns(
      (request.params as { thesisId: string }).thesisId,
    );

    return { ok: true, academicQaRuns };
  });

  app.post('/theses/:thesisId/intake-jobs', async (request, reply) => {
    const payload = createIntakeJobSchema.parse(request.body) as CreateIntakeJobInput;
    process.env.DATABASE_URL = testDatabaseUrl;
    const intakeJob = await (await getThesisLifecycle()).service.createIntakeJob(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return reply.status(201).send({ ok: true, intakeJob });
  });

  app.get('/theses/:thesisId/intake-jobs/:intakeJobId', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; intakeJobId: string };
    const intakeJob = await (await getThesisLifecycle()).service.getIntakeJob(params.thesisId, params.intakeJobId);

    return { ok: true, intakeJob };
  });

  app.get('/theses/:thesisId/intake-jobs/:intakeJobId/report', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; intakeJobId: string };
    const report = await (await getThesisLifecycle()).service.getIntakeReport(params.thesisId, params.intakeJobId);

    return { ok: true, report };
  });

  app.get('/theses/:thesisId/intake-jobs/:intakeJobId/nodes', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; intakeJobId: string };
    const nodes = await (await getThesisLifecycle()).service.listNormalizedNodes(params.thesisId, params.intakeJobId);

    return { ok: true, nodes };
  });

  app.get('/theses/:thesisId/latex/structure', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const structure = await (await getThesisLifecycle()).service.getLatexStructure(
      (request.params as { thesisId: string }).thesisId,
    );

    return { ok: true, structure };
  });

  app.get('/theses/:thesisId/latex/sections/:normalizedNodeId', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; normalizedNodeId: string };
    const section = await (await getThesisLifecycle()).service.getLatexSectionPreview(
      params.thesisId,
      params.normalizedNodeId,
    );

    return { ok: true, section };
  });

  app.post('/theses/:thesisId/latex/edits', async (request, reply) => {
    const payload = latexEditSchema.parse(request.body) as LatexEditRequest;
    process.env.DATABASE_URL = testDatabaseUrl;
    const result = await (await getThesisLifecycle()).service.editLatexSection(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return reply.status(201).send({ ok: true, edit: result });
  });

  app.post('/theses/:thesisId/latex/checkpoints/:checkpointId/restore', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; checkpointId: string };
    const restore = await (await getThesisLifecycle()).service.restoreLatexCheckpoint(params.thesisId, params.checkpointId);

    return { ok: true, restore };
  });

  app.post('/theses/:thesisId/latex/builds', async (request, reply) => {
    const payload = latexBuildSchema.parse(request.body) as { createdBy: string };
    process.env.DATABASE_URL = testDatabaseUrl;
    const build = await (await getThesisLifecycle()).service.runLatexBuild(
      (request.params as { thesisId: string }).thesisId,
      payload,
    );

    return reply.status(201).send({ ok: true, build });
  });

  app.get('/theses/:thesisId/latex/builds', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const builds = await (await getThesisLifecycle()).service.listBuildRuns(
      (request.params as { thesisId: string }).thesisId,
    );

    return {
      ok: true,
      history: {
        latestAttempted: builds[0] ?? null,
        latestSuccessful: builds.find((build) => build.isLatestSuccessful) ?? null,
        runs: builds,
      },
    };
  });

  app.get('/theses/:thesisId/latex/builds/:buildRunId', async (request) => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const params = request.params as { thesisId: string; buildRunId: string };
    const buildRun = await (await getThesisLifecycle()).service.getBuildRun(params.thesisId, params.buildRunId);

    return { ok: true, buildRun };
  });

  // --- DOI Resolution ---

  app.get('/resolve-doi', async (request, reply) => {
    const { doi } = request.query as { doi?: string };
    if (!doi) {
      return reply.status(400).send({ ok: false, error: 'Missing required "doi" query parameter.' });
    }

    // Dynamic import to avoid module resolution issues at startup
    const { resolveDoi } = await import('@thesis-research-os/research-engine');
    const mailto = process.env.CROSSREF_MAILTO;
    const result = await resolveDoi(doi, mailto);

    if (!result.ok) {
      return reply.status(result.statusCode === 404 ? 404 : 502).send({ ok: false, error: result.error });
    }

    return { ok: true, metadata: result.metadata };
  });

  app.post('/theses/:thesisId/sources/from-doi', async (request, reply) => {
    const { thesisId } = request.params as { thesisId: string };
    const { doi } = request.body as { doi?: string };

    if (!doi) {
      return reply.status(400).send({ ok: false, error: 'Missing required "doi" field in request body.' });
    }

    const { resolveDoi } = await import('@thesis-research-os/research-engine');
    const mailto = process.env.CROSSREF_MAILTO;
    const result = await resolveDoi(doi, mailto);

    if (!result.ok) {
      return reply.status(502).send({ ok: false, error: result.error });
    }

    const meta = result.metadata;
    process.env.DATABASE_URL = testDatabaseUrl;
    const source = await (await getThesisLifecycle()).service.registerSource(thesisId, {
      sourceType: meta.type === 'journal-article' ? 'article' : meta.type === 'book' ? 'book' : 'other',
      title: meta.title,
      authors: meta.authors,
      publicationYear: meta.publicationYear,
      locator: meta.url,
    });

    return reply.status(201).send({ ok: true, source, crossref: meta });
  });

  return app;
}

async function ensureDatabaseSchema(databaseUrl?: string) {
  await runMigrations(databaseUrl);
}
