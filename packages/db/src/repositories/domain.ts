import { eq } from 'drizzle-orm';

import type {
  AcademicQaIssueRecord,
  AcademicQaIssueRepository,
  AcademicQaRunRecord,
  AcademicQaRunRepository,
  BuildRunRecord,
  BuildRunRepository,
  CheckpointRecord,
  CheckpointRepository,
  ClaimEvidenceLinkRecord,
  ClaimEvidenceLinkRepository,
  ClaimRecord,
  ClaimRepository,
  ComplianceIssueRecord,
  ComplianceIssueRepository,
  ComplianceRunRecord,
  ComplianceRunRepository,
  DomainRepositoryRegistry,
  DomainRepositories,
  EvidenceFragmentRecord,
  EvidenceFragmentRepository,
  FeedbackEntryRecord,
  FeedbackEntryRepository,
  IntakeJobRecord,
  IntakeJobRepository,
  NormalizedNodeRecord,
  NormalizedNodeRepository,
  PolicyProfileRecord,
  PolicyProfileRepository,
  SourceRecord,
  SourceRepository,
  ThesisRecord,
  ThesisRepository,
  ThesisStateRecord,
  ThesisStateRepository,
  WorkflowPackRecord,
  WorkflowPackRepository,
  WorkflowStepRecord,
  WorkflowStepRepository,
  WorkflowTaskCheckpointRecord,
  WorkflowTaskCheckpointRepository,
  WorkflowTaskRecord,
  WorkflowTaskRepository,
  ZoteroMappingRecord,
  ZoteroMappingRepository,
} from '../contracts.js';
import type { ThesisDbClient } from '../client.js';
import {
  academicQaIssues,
  academicQaRuns,
  buildRuns,
  checkpoints,
  claimEvidenceLinks,
  claims,
  complianceIssues,
  complianceRuns,
  evidenceFragments,
  feedbackEntries,
  intakeJobs,
  normalizedNodes,
  policyProfiles,
  sources,
  theses,
  thesisStates,
  workflowPacks,
  workflowSteps,
  workflowTaskCheckpoints,
  workflowTasks,
  zoteroMappings,
} from '../schema.js';
import { GenericSqliteRepository } from './generic.js';
import { createPersistenceHelpers } from './helpers.js';

class ThesisSqliteRepository
  extends GenericSqliteRepository<ThesisRecord>
  implements ThesisRepository {}

class ThesisStateSqliteRepository
  extends GenericSqliteRepository<ThesisStateRecord>
  implements ThesisStateRepository {}

class WorkflowTaskSqliteRepository
  extends GenericSqliteRepository<WorkflowTaskRecord>
  implements WorkflowTaskRepository {}

class WorkflowTaskCheckpointSqliteRepository
  extends GenericSqliteRepository<WorkflowTaskCheckpointRecord>
  implements WorkflowTaskCheckpointRepository {}

class WorkflowPackSqliteRepository
  extends GenericSqliteRepository<WorkflowPackRecord>
  implements WorkflowPackRepository {}

class WorkflowStepSqliteRepository
  extends GenericSqliteRepository<WorkflowStepRecord>
  implements WorkflowStepRepository {}

class CheckpointSqliteRepository
  extends GenericSqliteRepository<CheckpointRecord>
  implements CheckpointRepository {}

class FeedbackEntrySqliteRepository
  extends GenericSqliteRepository<FeedbackEntryRecord>
  implements FeedbackEntryRepository {}

class IntakeJobSqliteRepository
  extends GenericSqliteRepository<IntakeJobRecord>
  implements IntakeJobRepository {}

class NormalizedNodeSqliteRepository
  extends GenericSqliteRepository<NormalizedNodeRecord>
  implements NormalizedNodeRepository {}

class SourceSqliteRepository
  extends GenericSqliteRepository<SourceRecord>
  implements SourceRepository {}

class EvidenceFragmentSqliteRepository
  extends GenericSqliteRepository<EvidenceFragmentRecord>
  implements EvidenceFragmentRepository {}

class ClaimSqliteRepository
  extends GenericSqliteRepository<ClaimRecord>
  implements ClaimRepository {}

class ClaimEvidenceLinkSqliteRepository
  extends GenericSqliteRepository<ClaimEvidenceLinkRecord>
  implements ClaimEvidenceLinkRepository {}

class ZoteroMappingSqliteRepository
  extends GenericSqliteRepository<ZoteroMappingRecord>
  implements ZoteroMappingRepository {}

class PolicyProfileSqliteRepository
  extends GenericSqliteRepository<PolicyProfileRecord>
  implements PolicyProfileRepository {
  async findActive(): Promise<PolicyProfileRecord | null> {
    const row = await this.db
      .select()
      .from(policyProfiles)
      .where(eq(policyProfiles.isActive, true))
      .limit(1)
      .get();

    return row ?? null;
  }
}

class ComplianceRunSqliteRepository
  extends GenericSqliteRepository<ComplianceRunRecord>
  implements ComplianceRunRepository {}

class ComplianceIssueSqliteRepository
  extends GenericSqliteRepository<ComplianceIssueRecord>
  implements ComplianceIssueRepository {}

class AcademicQaRunSqliteRepository
  extends GenericSqliteRepository<AcademicQaRunRecord>
  implements AcademicQaRunRepository {}

class AcademicQaIssueSqliteRepository
  extends GenericSqliteRepository<AcademicQaIssueRecord>
  implements AcademicQaIssueRepository {}

class BuildRunSqliteRepository
  extends GenericSqliteRepository<BuildRunRecord>
  implements BuildRunRepository {}

export function createDomainRepositories(db: ThesisDbClient): DomainRepositories {
  return {
    theses: new ThesisSqliteRepository(db, theses),
    thesisStates: new ThesisStateSqliteRepository(db, thesisStates),
    workflowTasks: new WorkflowTaskSqliteRepository(db, workflowTasks),
    workflowTaskCheckpoints: new WorkflowTaskCheckpointSqliteRepository(db, workflowTaskCheckpoints),
    workflowPacks: new WorkflowPackSqliteRepository(db, workflowPacks),
    workflowSteps: new WorkflowStepSqliteRepository(db, workflowSteps),
    checkpoints: new CheckpointSqliteRepository(db, checkpoints),
    feedbackEntries: new FeedbackEntrySqliteRepository(db, feedbackEntries),
    intakeJobs: new IntakeJobSqliteRepository(db, intakeJobs),
    normalizedNodes: new NormalizedNodeSqliteRepository(db, normalizedNodes),
    sources: new SourceSqliteRepository(db, sources),
    evidenceFragments: new EvidenceFragmentSqliteRepository(db, evidenceFragments),
    claims: new ClaimSqliteRepository(db, claims),
    claimEvidenceLinks: new ClaimEvidenceLinkSqliteRepository(db, claimEvidenceLinks),
    zoteroMappings: new ZoteroMappingSqliteRepository(db, zoteroMappings),
    policyProfiles: new PolicyProfileSqliteRepository(db, policyProfiles),
    complianceRuns: new ComplianceRunSqliteRepository(db, complianceRuns),
    complianceIssues: new ComplianceIssueSqliteRepository(db, complianceIssues),
    academicQaRuns: new AcademicQaRunSqliteRepository(db, academicQaRuns),
    academicQaIssues: new AcademicQaIssueSqliteRepository(db, academicQaIssues),
    buildRuns: new BuildRunSqliteRepository(db, buildRuns),
  };
}

export function createDomainRepositoryRegistry(db: ThesisDbClient): DomainRepositoryRegistry {
  return {
    repositories: createDomainRepositories(db),
    helpers: createPersistenceHelpers(),
  };
}
