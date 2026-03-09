# Domain Model

Core entity and relationship notes.

**What belongs here:** canonical entity names, stable ID expectations, ordering rules, and thesis-scoping rules.

---

## Core entities
- thesis
- thesis_state
- thesis_transition
- checkpoint
- feedback_entry
- workflow_task
- workflow_task_checkpoint
- workflow_pack / workflow_step
- intake_job
- normalized_node
- source
- evidence_fragment
- claim
- claim_evidence_link
- zotero_mapping
- policy_profile
- compliance_run
- compliance_issue
- academic_qa_run
- academic_qa_issue
- build_run

## Scoping rules
- Thesis is the primary root scope for almost all entities.
- Cross-thesis leakage is never acceptable for memory, evidence, Zotero mappings, QA/compliance runs, or UI route data.
- Ordered lists should use deterministic newest-first or explicit position ordering; do not rely on incidental insertion order.
