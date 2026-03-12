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
  CitationRecord,
  CitationRepository,
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
  citations,
  workflowPacks,
  workflowSteps,
  workflowTaskCheckpoints,
  workflowTasks,
  zoteroMappings,
} from '../schema.js';
import { GenericSqliteRepository } from './generic.js';
export { createEntityId, createPersistenceHelpers, createTimestamp } from './helpers.js';
import { createPersistenceHelpers } from './helpers.js';

class ThesisSqliteRepository
  extends GenericSqliteRepository<ThesisRecord>
  implements ThesisRepository {
  constructor(db: ThesisDbClient) {
    super(db, theses);
  }

  async findBySlug(slug: string): Promise<Pick<ThesisRecord, 'id'> | null> {
    const row = await this.db.query.theses.findFirst({
      columns: {
        id: true,
      },
      where: (fields, operators) => operators.eq(fields.slug, slug),
    });

    return row ?? null;
  }
}

class ThesisStateSqliteRepository
  extends GenericSqliteRepository<ThesisStateRecord>
  implements ThesisStateRepository {
  constructor(db: ThesisDbClient) {
    super(db, thesisStates);
  }
}

class WorkflowTaskSqliteRepository
  extends GenericSqliteRepository<WorkflowTaskRecord>
  implements WorkflowTaskRepository {
  constructor(db: ThesisDbClient) {
    super(db, workflowTasks);
  }
}

class WorkflowTaskCheckpointSqliteRepository
  extends GenericSqliteRepository<WorkflowTaskCheckpointRecord>
  implements WorkflowTaskCheckpointRepository {
  constructor(db: ThesisDbClient) {
    super(db, workflowTaskCheckpoints);
  }
}

class WorkflowPackSqliteRepository
  extends GenericSqliteRepository<WorkflowPackRecord>
  implements WorkflowPackRepository {
  constructor(db: ThesisDbClient) {
    super(db, workflowPacks);
  }
}

class WorkflowStepSqliteRepository
  extends GenericSqliteRepository<WorkflowStepRecord>
  implements WorkflowStepRepository {
  constructor(db: ThesisDbClient) {
    super(db, workflowSteps);
  }
}

class CheckpointSqliteRepository
  extends GenericSqliteRepository<CheckpointRecord>
  implements CheckpointRepository {
  constructor(db: ThesisDbClient) {
    super(db, checkpoints);
  }
}

class FeedbackEntrySqliteRepository
  extends GenericSqliteRepository<FeedbackEntryRecord>
  implements FeedbackEntryRepository {
  constructor(db: ThesisDbClient) {
    super(db, feedbackEntries);
  }
}

class IntakeJobSqliteRepository
  extends GenericSqliteRepository<IntakeJobRecord>
  implements IntakeJobRepository {
  constructor(db: ThesisDbClient) {
    super(db, intakeJobs);
  }
}

class NormalizedNodeSqliteRepository
  extends GenericSqliteRepository<NormalizedNodeRecord>
  implements NormalizedNodeRepository {
  constructor(db: ThesisDbClient) {
    super(db, normalizedNodes);
  }
}

class SourceSqliteRepository
  extends GenericSqliteRepository<SourceRecord>
  implements SourceRepository {
  constructor(db: ThesisDbClient) {
    super(db, sources);
  }
}

class EvidenceFragmentSqliteRepository
  extends GenericSqliteRepository<EvidenceFragmentRecord>
  implements EvidenceFragmentRepository {
  constructor(db: ThesisDbClient) {
    super(db, evidenceFragments);
  }
}

class ClaimSqliteRepository
  extends GenericSqliteRepository<ClaimRecord>
  implements ClaimRepository {
  constructor(db: ThesisDbClient) {
    super(db, claims);
  }
}

class ClaimEvidenceLinkSqliteRepository
  extends GenericSqliteRepository<ClaimEvidenceLinkRecord>
  implements ClaimEvidenceLinkRepository {
  constructor(db: ThesisDbClient) {
    super(db, claimEvidenceLinks);
  }
}

class ZoteroMappingSqliteRepository
  extends GenericSqliteRepository<ZoteroMappingRecord>
  implements ZoteroMappingRepository {
  constructor(db: ThesisDbClient) {
    super(db, zoteroMappings);
  }
}

class CitationSqliteRepository
  extends GenericSqliteRepository<CitationRecord>
  implements CitationRepository {
  constructor(db: ThesisDbClient) {
    super(db, citations);
  }
}

class PolicyProfileSqliteRepository
  extends GenericSqliteRepository<PolicyProfileRecord>
  implements PolicyProfileRepository {
  constructor(db: ThesisDbClient) {
    super(db, policyProfiles);
  }

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
  implements ComplianceRunRepository {
  constructor(db: ThesisDbClient) {
    super(db, complianceRuns);
  }
}

class ComplianceIssueSqliteRepository
  extends GenericSqliteRepository<ComplianceIssueRecord>
  implements ComplianceIssueRepository {
  constructor(db: ThesisDbClient) {
    super(db, complianceIssues);
  }
}

class AcademicQaRunSqliteRepository
  extends GenericSqliteRepository<AcademicQaRunRecord>
  implements AcademicQaRunRepository {
  constructor(db: ThesisDbClient) {
    super(db, academicQaRuns);
  }
}

class AcademicQaIssueSqliteRepository
  extends GenericSqliteRepository<AcademicQaIssueRecord>
  implements AcademicQaIssueRepository {
  constructor(db: ThesisDbClient) {
    super(db, academicQaIssues);
  }
}

class BuildRunSqliteRepository
  extends GenericSqliteRepository<BuildRunRecord>
  implements BuildRunRepository {
  constructor(db: ThesisDbClient) {
    super(db, buildRuns);
  }
}

export function createDomainRepositories(db: ThesisDbClient): DomainRepositories {
  return {
    theses: new ThesisSqliteRepository(db),
    thesisStates: new ThesisStateSqliteRepository(db),
    workflowTasks: new WorkflowTaskSqliteRepository(db),
    workflowTaskCheckpoints: new WorkflowTaskCheckpointSqliteRepository(db),
    workflowPacks: new WorkflowPackSqliteRepository(db),
    workflowSteps: new WorkflowStepSqliteRepository(db),
    checkpoints: new CheckpointSqliteRepository(db),
    feedbackEntries: new FeedbackEntrySqliteRepository(db),
    intakeJobs: new IntakeJobSqliteRepository(db),
    normalizedNodes: new NormalizedNodeSqliteRepository(db),
    sources: new SourceSqliteRepository(db),
    evidenceFragments: new EvidenceFragmentSqliteRepository(db),
    claims: new ClaimSqliteRepository(db),
    claimEvidenceLinks: new ClaimEvidenceLinkSqliteRepository(db),
    zoteroMappings: new ZoteroMappingSqliteRepository(db),
    citations: new CitationSqliteRepository(db),
    policyProfiles: new PolicyProfileSqliteRepository(db),
    complianceRuns: new ComplianceRunSqliteRepository(db),
    complianceIssues: new ComplianceIssueSqliteRepository(db),
    academicQaRuns: new AcademicQaRunSqliteRepository(db),
    academicQaIssues: new AcademicQaIssueSqliteRepository(db),
    buildRuns: new BuildRunSqliteRepository(db),
  };
}

export function createDomainRepositoryRegistry(db: ThesisDbClient): DomainRepositoryRegistry {
  return {
    repositories: createDomainRepositories(db),
    helpers: createPersistenceHelpers(),
  };
}
