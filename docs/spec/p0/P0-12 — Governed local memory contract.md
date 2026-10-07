<aside>
🧠

Memory is user-owned, scoped knowledge—not an invisible side effect of conversation. Agents propose writes; trusted services enforce provenance, authority, access, retention, and deletion. Retrieval never expands permissions, and remembered text cannot override policy or become proof merely because it was stored.

</aside>

## Purpose and implementation boundary

Define local memory records, scope/grants, authority and mutability, provenance, governed writes, conflict handling, retrieval/context assembly, retention/expiry, inspection/editing/export, forgetting/deletion, index rebuilding, and recovery.

Initial implementation: protected local project/session memory plus explicitly enabled personal preferences, bounded local retrieval, versioned write proposals, human/standing-policy approval, and inspect/edit/disable/forget/delete controls. Start without a persistent vector database or remote embedding service.

This document does not authorize importing workspace data, indexing folders, creating sensitive memories, sending content to models, installing an embedding runtime, sharing memories, or deleting existing user data. Each requires actual scoped authority and accepted implementation gates.

Excluded initially: cloud memory/sync, collaborative organizational memory, autonomous global identity profiling, unreviewed sensitive-category capture, cross-project search, universal digital-twin ingestion, agent-to-agent shared mutable memory, and remote embeddings.

### Governing specifications

- P0-11 — Task graph and isolated subagent execution contract.
- P0-07 — Agent runtime state machine.
- P0-08 — Provider gateway and normalized stream contract.
- P0-09 — Tools, policy, and sandbox execution contract.
- P0-10 — Verification gate and evidence-backed completion contract.
- P0-02 — Canonical event taxonomy & schema.
- P0-03 — SQLite event store, content & projections.
- P0-05 — Project-isolation threat model.
- Frontend UX — Settings architecture.

## 1. Core invariants

1. Memory read/write/transfer/delete permissions are separate; permission to converse or read a file is not consent to remember it persistently.
2. The trusted memory service owns state changes; models, plugins, tools, and renderers cannot insert arbitrary canonical memories.
3. Every revision has immutable scope, source lineage, authority/mutability, sensitivity, retention, and protection references.
4. Project boundaries remain primary. Personal/workspace data is available only through explicit grants and need-to-know selection.
5. Relevance scores, confidence, frequency, or model consensus cannot promote authority or override security restrictions.
6. Memory content is untrusted context unless backed by an identified authoritative source; even authoritative content cannot grant tools or supersede hard policy.
7. Model-generated facts are inferred/proposed, never silently human-confirmed.
8. Writes/updates/merges are explicit versioned operations with idempotency and expected revision checks.
9. Sensitive categories are disabled by default; credentials and authentication secrets are not memory.
10. Authoritative payloads and derivatives remain protected; embeddings/indexes/summaries do not become ungoverned copies.
11. Revocation/forgetting/deletion suppresses future retrieval immediately through an authoritative generation check, even if index cleanup is pending.
12. No cross-scope deduplication exposes record existence or shares mutable content/key ownership implicitly.
13. Replay can rebuild structural state but cannot recreate erased payloads or resurrect deleted memories.
14. Deletion claims state exact coverage and residual copies; no unsupported forensic-erasure or remote-recall promise.
15. Subagents receive explicit snapshots/grants, not ambient persistent access inherited from a manager role.

## 2. What memory is—and is not

Separate these objects:

- **conversation:** protected session messages and runtime history;
- **working context:** ephemeral assembled inputs for a particular attempt;
- **checkpoint:** durable runtime recovery reference;
- **memory:** deliberately retained reusable knowledge/preferences;
- **authoritative source:** reviewed external/local document or human-maintained fact;
- **artifact/evidence:** scoped outputs and observations, not automatically generalized memory;
- **index/embedding:** disposable retrieval derivative, never authority.

Summarizing a conversation does not automatically create memory. A verified child report is evidence for its specific task/candidate, not a timeless fact about a project. Generated model reasoning traces are not memory sources.

Memory must not replace task/event truth: run state, tool outcomes, budgets, approval grants, and completion evidence remain in their owning domains. A remembered “tests passed” cannot satisfy P0-10 for a changed candidate.

## 3. Memory scopes and explicit grants

| Scope | Intended use | Initial rule |
| --- | --- | --- |
| Personal/user | Explicit preferences/facts chosen by the user | Disabled for automatic capture; named read/write grants |
| Workspace | Shared workspace knowledge/policy references | Model reserved; collaboration/organization workflows deferred |
| Team | Department knowledge | Reserved until team access model exists |
| Project | Bounded project facts/conventions | Scoped read/write proposals; no access from another project by default |
| Agent | Reusable role-specific knowledge | Must also bind an owning user/workspace/project and grants; no global agent cache |
| Session/task | Temporary relevant observations | Scoped to session/task and expiry; not promoted automatically |

Scope uses typed fields with valid combinations—not arbitrary labels such as global or company-wide. Reserve future scopes without enabling unsupported ACL semantics.

MemoryAccessGrant binds principal/agent definition, exact owner/scope, operations, allowed categories/sources, privacy class, delegability, expiry, and policy revision. Organizational seniority, same provider account, or matching text does not authorize retrieval.

A user may explicitly share a personal preference with selected projects/agents. That is a read grant over the preference, not a transfer of all personal memory or permission to write it back. A project-derived fact cannot become personal/shared memory without a reviewed promotion/transfer operation and provenance.

Human memory-browser access is resolved from trusted user authority; it is distinct from the selected agent’s grant. Search results/counts must not reveal records outside the requester’s allowed scope.

## 4. Record and revision model

MemoryRecord contains MemoryId, scope/owner, current revision, lifecycle state, policy/retention references, and protected metadata references.

MemoryRevision includes:

- MemoryRevisionId and predecessor/supersession reference;
- protected content/title/category references and content kind;
- subject/topic/claim type where reviewed;
- source/provenance lineage and extraction context;
- authority, mutability, confidence status, sensitivity;
- valid-from/valid-until, observed time, review due time;
- approval/standing-rule provenance;
- retention/expiry/deletion generation;
- conflict/correction/derivation references;
- protection/key references and integrity metadata in protected storage.

Backend typed IDs: MemoryId, MemoryRevisionId, MemoryProposalId, MemoryGrantId, MemorySourceId, MemoryConflictId, MemoryDeletionId, IndexGeneration, and AccessGeneration. Reuse ContentId, artifact/evidence/runtime identity, RequestId, and correlation IDs.

Names, topics, tags, sources, extracted claims, and content-derived hashes may be sensitive. Do not treat all metadata as safe to persist plaintext or export. Structural events use IDs, bounded enums, counts, and references.

Scope is immutable for a record. Moving/promoting creates a new record or an explicit governed transfer lineage; changing a scope field cannot bypass authorization.

## 5. Authority, mutability, and confidence

### Authority

- **locked-authoritative:** a named human/organization-maintained source or explicitly confirmed fact;
- **managed-editable:** maintained documentation/knowledge under its owner’s review policy;
- **working-generated:** extracted/inferred summaries and observations.

### Mutability

- human-only;
- agent-proposal/review-required;
- approved standing-policy edits within specific categories/sources;
- temporary/expiry-managed.

Authority and mutability are independent. Read-only generated text does not become authoritative. A trusted source label alone is insufficient without source identity/version and authorization.

Confidence: confirmed-by-authorized-human, source-supported, inferred, disputed, or unknown. Numeric confidence may be supplementary but never upgrades authority.

Agents may propose corrections to locked records; they cannot apply them. A human-confirmed fact identifies the authorized confirmer and exact content revision. Model inference about identity, health, finances, or personal relationships cannot be relabeled confirmation merely because it appears repeatedly in conversations.

## 6. Provenance and source lifecycle

Provenance records exact source content/artifact/version, source authority, scope and original grants, observed timestamp, authorized extraction operation/provider/model/prompt version where used, and relevant evidence references.

Claims distinguish quotation, summary, factual extraction, inference, and user preference. Preserve uncertainty and qualifiers; never convert “might,” “used to,” or “for this session” into a permanent categorical fact.

Source changes trigger review/invalidation of affected memories. A source being authoritative does not make all summaries faithful; extraction quality remains separately checked. Conflicting sources are not silently averaged.

Maintain lineage for known derivatives: revisions, summaries, snapshots, cached excerpts, chunks, indexes/embeddings, exports controlled by Adham, and context assemblies. Lineage tracks known copies, not a guarantee of discovering every paraphrase a model has ever emitted.

Imported project instructions/web/tool results remain untrusted source content. They cannot authorize memory writes, invent human consent, expand scope, or set themselves to locked-authoritative.

## 7. Governed write pipeline

Default model path:

```
potential useful fact
→ protected MemoryProposal
→ scope/category/provenance validation
→ sensitivity/policy/duplication/conflict checks
→ exact review or bounded standing rule
→ atomic revision/content/event/receipt/projection commit
→ index invalidation/rebuild hint
```

Proposal fields include proposed content, source lineage, target scope, purpose, retention/expiry, sensitivity, authority requested, confidence, expected existing revision, and reason for retention. Content stays protected; events reference it.

Rejected proposals are not retrievable as active memories. Retain proposal payload only under its explicit short policy, not indefinitely because the user declined storage.

Standing write rules name exact scopes/categories/source types and allowed transformations, budgets/count limits, authority ceiling, retention, and expiry. They cannot capture credentials, broaden sharing, modify locked sources, or infer sensitive categories silently.

Automatic writes occur only when an explicitly enabled standing policy applies. Avoid approval fatigue through narrow rules—not hidden learning of broader consent. UI shows what was remembered and why, with inspect/undo-forget controls.

Transaction commits approved protected content, revision, structural event, idempotency receipt, and active-memory projection together. Duplicate RequestId/same payload returns original result; different scope/content conflicts. Receipts must not contain unprotected memory text.

## 8. Sensitive content and prohibited storage

Never store API keys, passwords, recovery phrases, authentication codes, cookies/session tokens, private key material, or credential vault values as memory. Store only approved opaque credential references in the credential domain—not remembered secret text.

Sensitive identity/health/financial/legal/location/minor-related categories require explicit opt-in and narrow purpose/read/write/retention policy. A generic “remember useful details” instruction does not opt into every category.

Minimize facts about third parties; do not treat user permission as unlimited consent for profiling other people. Record source and purpose, and surface uncertainty/ownership limits.

Sensitive-category detection is a conservative guardrail, not perfect classification. If uncertain under a restrictive policy, keep proposal blocked for review. Do not send it to a cloud classifier solely to decide whether cloud disclosure is allowed.

Use local validation first. Any model extraction, summarization, or embedding request consumes P0-08 grants/privacy/budget; no background content transfer implied by enabling memory.

## 9. Editing, supersession, merging, and conflicts

Edit creates a new protected revision with expected-current-revision checks. Human correction can lower/remove an inferred claim or change scope only through an explicit transfer—not rewrite history.

Old revision payload retention follows policy and may be erased; immutable structural history contains no body that would prevent deletion. Retrieval normally uses only active current revisions unless authorized history inspection is requested.

Deduplication is scope-local and privacy-safe. Do not use unkeyed low-entropy claim hashes in public events, or return “duplicate in another project” to reveal private existence. Do not share one erasable content object across unrelated records without an explicit reference/ownership deletion model.

Merge is a proposal with exact input revisions, retained provenance, authority ceiling, and conflict disposition. It cannot blend contradictory locked facts into a fabricated consensus.

Conflict handling:

- prefer currently valid highest-authority source for the stated claim;
- preserve contradiction and source versions;
- request authorized review if equal authority/current validity cannot resolve it;
- do not choose newest text solely by timestamp;
- invalidate affected derived context/evidence where relevant.

Pinning affects retention/ranking only; it grants no authority, no cross-scope access, and no exemption from deletion/current policy.

## 10. Retrieval authorization and pipeline

```
trusted execution identity and current policy
→ permitted scope/category/source set
→ active/current/not-forgotten/not-erased/valid records
→ authorized candidate generation
→ bounded relevance ranking
→ provenance/authority/conflict/freshness checks
→ privacy-safe excerpt selection
→ protected ContextManifest
→ provider gateway or local caller
```

Apply authorization before candidate scoring where feasible, and revalidate every returned record immediately before reveal/context dispatch. A global top-k search followed by filtering is not the initial design: it can expose unauthorized content to rankers and cause misleading retrieval gaps.

Queries are private content. Query logs and telemetry contain no raw text or unauthorized hit counts. Cache keys include full owner/project/agent/session identity, grant/policy/access generation, memory revision and retrieval profile.

Return typed excerpts with MemoryId/revision, source authority, confidence/uncertainty, validity/freshness, and allowed use. No automatic writeback from a retrieval result.

Absence of a permitted hit means “no applicable authorized memory found,” not proof no fact exists. Conflicted/stale sources are labeled or withheld according to policy; retrieval cannot manufacture certainty.

## 11. Context integration and prompt-injection boundary

ContextManifest records exact memory revisions/excerpt ranges, access/policy generation, source lineage, authority, purpose, privacy class, and provider transfer decision. Keep excerpts protected; structural references alone are not private text.

Memory is contextual data, not privileged instructions. Use explicit provenance/role boundaries; do not insert retrieved instructions into the system policy tier merely because a record is pinned/authoritative.

Ignore embedded attempts to reveal secrets, approve tools, skip verification, modify grants, write more memory, or redirect the task. Authority governs domain facts/source priority; it does not confer action permissions.

Before provider dispatch, check all grants/generations again. Local-only memory cannot be sent to cloud through a session setting or child fallback. Transfer approval names provider/account and data class under P0-08; enablement of memory alone authorizes no external transfer.

A model answer may cite/use remembered facts only with their uncertainty/current validity preserved. No requirement to expose hidden model reasoning; raw thinking traces are not persisted as memory.

## 12. Initial retrieval/storage strategy

Canonical memory state uses protected content plus SQLite structural records/projections under P0-03. Avoid plaintext replicas in FTS tables, tags, logs, caches, temporary files, or generated index dumps.

Initial search: bounded scope-filtered retrieval with transient in-process authorized lexical ranking over protected records. Decrypt only permitted bounded content, minimize lifetime, avoid durable plaintext/swap/crash-dump exposure where the platform permits, and document residual host-memory risk. No ordinary SQLite plaintext FTS index is added for convenience.

Suggested baseline limits:

| Limit | Baseline |
| --- | --- |
| One memory/proposal text body | 16 KiB UTF-8 |
| Pending proposals per project | 128 |
| Authorized candidate scan per query | 500 current records with byte/time bounds |
| Total revealed candidate bytes | 2 MiB per query maximum |
| Selected excerpts | 10 records, 16 KiB total, subordinate to model token budget |
| Read/edit UI page | 50 default, 100 maximum, opaque scope-bound cursor |
| Local retrieval deadline | 2 seconds; bounded failure/truncation status |
| Stored memory capacity | Explicit installation/project count and protected-byte quota before enabling writes |

If bounded scanning cannot cover the permitted scope, report incomplete search and require narrower filters or an approved index strategy; do not silently imply exhaustive search. Exact ranking/token-count mechanics and Unicode normalization require reviewed fixtures for English, Arabic, Simplified Chinese, and Russian. Preserve original content; normalization is a retrieval derivative, not a rewrite of the fact.

## 13. Future embeddings and rebuildable indexes

A vector index is optional, never prerequisite for governed memory. Add it only after authorization, protected storage, deletion lineage, and isolation pass.

Requirements before any embedding/index implementation:

- reviewed local model/runtime and dependency/provisioning authority;
- explicit embedding profile/model revision/dimensions/tokenization and scope partition;
- vectors/text/chunks treated as sensitive derivatives with protection and deletion lineage;
- index never holds the sole copy of a fact or authorizes access;
- candidate authorization before reveal/rerank and current generation checks;
- no mixed-project shared index/cross-scope nearest-neighbor leakage by default;
- atomic generation activation, stale generation exclusion, rebuild/fault/deletion tests;
- cleanup of old vector/index snapshots, caches and backups under declared policy.

Remote embeddings are excluded initially. Future remote embedding requests require P0-08 provider/data transfer approval, account grants, retention/pricing/usage budgets, and explicit disclosure of which content is sent. “Only embeddings” is not a privacy exemption.

Index rebuild can fail or lag without resurrecting forgotten records: authoritative active/access/deletion checks override every index hit. Locked vault/unavailable keys make retrieval unavailable, not a plaintext fallback.

## 14. Runtime, graphs, and child-session integration

P0-07 run context freezes selected memory revisions, but new restrictions/forget/delete generations apply to future dispatch immediately. A frozen snapshot cannot preserve revoked authority indefinitely.

P0-11 children get explicit ContextShard excerpts and optionally narrowed delegable memory grants. No sibling/parent private memory access by default, no shared mutable store, and no automatically inherited user memory.

Child memory writes are proposals to the owning scope. A verified child report can support a memory proposal with precise candidate/source references, but is not automatically remembered or promoted to authoritative knowledge.

Cross-project handoff creates an explicit transfer proposal with authorized selected content and lineage. Manager/executive reporting does not grant unrestricted source memory. If a transfer requires broader permissions than P0-11 supports, block rather than silently broaden the graph.

Memory actions consume parent/child budget under the same ledger. Summarization/extraction/indexing cannot spawn free background model calls.

## 15. Retention, expiry, disable, and forget

States distinguish proposed, active, superseded, disputed, expired, forgotten, deletion-pending, and erased. Index state is separate from authoritative lifecycle.

- **Disable reads:** stop retrieval/context inclusion for specified scope/principal; existing data remains stored.
- **Disable writes:** stop new proposals/automatic retention, not merely hide UI.
- **Expire:** validity/retention policy suppresses retrieval; removal follows declared cleanup policy.
- **Forget:** immediately exclude selected record/category from future use and invalidate caches/context; payload may remain until the disclosed retention/deletion step.
- **Delete:** execute explicit removal of active controlled payloads/derivatives with coverage reporting.

UI must not use these labels interchangeably. Pinning does not defeat explicit deletion or safety restrictions.

Default new inferred/session observations require a finite expiry; suggested development policy is 30 days for working project observations and session end/24-hour maximum for temporary session-only memory. Human-confirmed preferences may be explicitly retained until changed/deleted, with review controls. Final category defaults must be accepted before real writes.

Expiry uses trusted clock policy and durable generations; clock rollback cannot revive expired authority silently. Review-due differs from validity expiry: a fact may be stale/disputed rather than presumed false.

## 16. Deletion protocol and coverage ledger

Deletion is a durable operation with preview, exact scope/record selection, current revision checks, RequestId idempotency, and authorized actor.

1. Compute known lineage/copy inventory and disclose scope, dependencies, backups/exports/remote limitations.
2. Atomically set deletion-pending/forgotten, bump AccessGeneration/DeletionGeneration, remove active retrieval eligibility, append structural intent, and store receipt.
3. Stop/fence new dispatches that reference revoked content; invalidate indexed hits/caches/context manifests.
4. Remove controlled protected record/revision/proposal payloads and known memory-owned derivatives; write non-content tombstones.
5. Resolve shared reference ownership explicitly. A memory delete does not silently delete unrelated source conversations/evidence; offer broader source/derivative deletion as a separate reviewed scope.
6. Clean index generations, excerpts, memory-owned summaries/temp/staging and controlled snapshots according to their retention contracts.
7. Record per-copy coverage: removed, key-disabled under validated scheme, suppressed pending cleanup, retained under separate declared scope, external/uncontrolled, unknown.
8. Commit final operation settlement and show remaining limitations.

Immediate retrieval suppression is required even if cleanup crashes. Unknown/pending controlled derivative cleanup means deletion incomplete—not a blanket success. Retry uses the same operation and continues the journal; no resurrection through replay/index rebuild.

Known copied snippets in checkpoints/context/evidence may require payload erasure or scope-specific redaction/tombstone. P0-10 applicability can become stale/degraded; never fabricate replacement evidence or reopen terminal runs. Deletion of source conversation/artifacts is not implied by deleting an extracted memory; explain both directions of lineage.

## 17. Erasure guarantees, backups, exports, and remote content

Do not promise forensic erasure from SSDs, filesystem snapshots, WAL/free pages, process memory, crash dumps, user exports, or provider systems merely because a row was deleted.

Application-level encryption helps confidentiality but cryptographic erasure requires a reviewed per-record/revision key lifecycle with no remaining recoverable key copies. Deleting a wrapped key from the active database is insufficient if an old backup contains it and the wrapping key still works. Do not call rotating a common master key a completed per-record erasure strategy without validated recovery/copy handling.

Before any “permanently deleted” claim, specify and test:

- active payload and derivative/key ownership;
- WAL/checkpoint/temporary-file behavior and limitations;
- backup retention/key availability and deletion or suppression policy;
- restore prevention and independently protected deletion ledger;
- exported/uncontrolled copies and remote transfer status;
- exact residual host/storage recovery risk.

Initial honest claim: selected memories are no longer retrievable, active controlled payloads/derivatives have the recorded removal coverage, and stated backups/external/source copies may remain. Expose incomplete cleanup explicitly.

Memory export is a separate user action with protected/encrypted package, selected scope, provenance/authority/retention metadata, and no credentials/raw host paths. Recipient/import authority is not inherited automatically from exported labels. User-managed exported copies cannot be recalled by Adham; disclose that limit.

Already sent provider content cannot be unsent. Where supported, remote deletion can be a separately authorized recorded request with limited provider evidence, not a universal recall guarantee. No automated provider data transfer is initiated solely to erase local memory.

## 18. Restore and resurrection prevention

Maintain a protected monotonic deletion/suppression ledger outside the database being replaced by a restore. It records minimal opaque identities/generations, not deleted content or public low-entropy hashes. Review its own backup/key/permission/failure lifecycle.

Restore candidate flow:

1. Validate backup integrity/schema in quarantine.
2. Load current suppression ledger and current access policy.
3. Apply newer forget/delete/revocation generations to restored records and derivatives before activation.
4. Rebuild permitted current indexes only; never activate old index hits blindly.
5. If ledger missing/incompatible/untrusted, block restoration from re-enabling memory until explicit reviewed reconciliation.
6. Keep restored memory disabled while unresolved deletion coverage exists.

A full machine rollback/restore including both database and ledger may defeat local resurrection prevention; state that residual risk and require a broader trusted recovery design before stronger guarantees. Do not invent an independent ledger surviving every possible host rollback.

Suppression applies to known record/source lineage. Reimporting paraphrased or newly obtained data cannot always be recognized; explicit reimport review and source/category rules reduce risk without claiming universal semantic erasure detection.

## 19. Revocation races and in-flight context

Before returning an excerpt or dispatching to a provider, validate AccessGeneration and current grant/record lifecycle. Concurrent forget/delete wins over any later uncommitted reveal/admission using the old generation.

If content was already revealed to the human/model or sent in an active request, acknowledge the boundary: cancellation may stop further work but cannot undo disclosure. Stop future dispatch, drop accessible cached excerpts, mark affected snapshots blocked/stale, and reconcile running children/providers under P0-07–11.

Active memory borrowers do not retain indefinite read authority. A deletion/disable action invalidates reusable handles; models/tools cannot fetch removed content through artifact IDs from old context.

Historical outputs containing the fact remain separate protected content unless included in an explicit broader deletion operation. UI previews known copies so “delete memory” is not falsely presented as “delete every occurrence everywhere.”

## 20. Startup, migration, crash recovery, and observability

Memory startup requires storage/protection readiness, validated current records/tombstones/generations, index compatibility, suppression ledger availability, and current policy. Unavailable keys/indexes cannot silently relax controls.

Migrations are embedded/reviewed and preserve historical event meaning; unknown future memory payload/source/index versions block affected reads/writes safely. An index may rebuild from permitted surviving current content, but erased payloads remain tombstones.

Recovery resumes pending approved writes/deletions through receipts/journals, never re-asks a model to reconstruct deleted facts. Rolled-back writes are absent; committed writes/proposals keep original IDs/provenance. Partial deletion remains suppressed until cleanup settlement.

Allowed default diagnostics: operation, safe outcome code, counts/size buckets, duration, generation/revision, index health. Forbidden: raw query, memory text/title/topic, source path, content-derived public fingerprints, embeddings, prompt/output, key references, or private category/identity details. Telemetry stays off by default and content-free.

## 21. User experience and safe operations

Memory browser exposes owner/scope, source/authority/confidence, lifecycle/expiry, sharing/read/write grants, revision/conflict history, reason remembered, and protection/deletion status.

Actions: inspect, propose/edit/correct, pin, resolve conflict, approve/reject proposal, disable reads/writes, forget, preview/delete, export selected content, and view cleanup/restore limitations.

Security-sensitive actions use a review step and safe explicit wording. Harmless display filters do not mutate stored knowledge. Bulk actions preview exact counts/scope and known derivative/source impact; scope-bound cursors prevent page changes from silently selecting different records.

Use localization keys and accessible keyboard/Arabic RTL controls; technical IDs/paths render with safe direction isolation. Do not persist memory text in renderer localStorage/sessionStorage/query-cache storage. Frontend query keys include complete scope and current access generation.

## 22. Events, SQLite amendments, and IPC

Use reviewed P0-02 memory families: memory/write-proposed, memory/write-approved, memory/written, memory/forgotten. Add registered/versioned revision/conflict/grant/expiry/deletion/transfer/index-generation facts as needed before implementation.

Project memory facts use the project stream; session memory facts use the session stream. Initial explicitly shared personal preference facts may use an owning personal workspace stream with restricted user/record scope metadata and reviewed grant checks; workspace parentage never implies every workspace agent can read them. Do not create global memory streams or unsupported team actors without an envelope/registry amendment.

SQLite amendments introduce structural records/revisions/grants/provenance/deletion journals/current projections and protected payload references. Model exact sensitivity: titles/tags/source metadata may need protected content rather than plaintext query columns. Persistent indexes cannot bypass content protection.

Proposed application commands: ProposeMemoryWrite, ResolveMemoryProposal, EditMemory, QueryMemory, GetMemoryPage, ResolveMemoryConflict, SetMemoryAccess, ForgetMemory, PreviewMemoryDeletion, DeleteMemory, GetDeletionStatus, and ExportMemorySelection.

These are not permitted Tauri endpoints until P0-04 DTOs, context/grant checks, limits, window capabilities, safe errors, generated bindings, and tests are amended. No raw SQL/vector query, set-authoritative-from-model, arbitrary scope grant, or generic memory dispatch endpoint.

All mutations use RequestId/expected revision and safe non-content receipts. Notifications carry only authorized scope/generation invalidation—not text, query, or sensitive category names.

## 23. Rust ownership and modules

```
crates/adham-memory/src/
├── lib.rs
├── domain/
│   ├── record.rs
│   ├── revision.rs
│   ├── scope.rs
│   ├── authority.rs
│   ├── provenance.rs
│   ├── proposal.rs
│   ├── conflict.rs
│   ├── retention.rs
│   └── deletion.rs
├── application/
│   ├── write.rs
│   ├── retrieve.rs
│   ├── edit.rs
│   ├── transfer.rs
│   ├── forget.rs
│   ├── erase.rs
│   ├── export.rs
│   └── recover.rs
└── ports/
    ├── persistence.rs
    ├── protection.rs
    ├── policy.rs
    ├── index.rs
    └── lineage.rs
```

adham-context assembles authorized excerpts; adham-policy authorizes operations/grants; platform/storage adapters handle protection and durable journals; provider adapters never query memory directly. Transaction/effect boundaries reuse P0-03 unit-of-work semantics. Do not build a generic mutable global memory singleton.

Vector/tokenizer/embedding/search dependencies are deferred unless the bounded first strategy proves inadequate and a reviewed proposal defines protection/isolation/deletion. Respect source target under 300 lines, review above 400, and documented exceptions above 600.

## 24. Required test matrix

| Area | Required cases |
| --- | --- |
| Scope/access | Project A/B isolation; user preference explicit grant; agent/team reserved scopes denied; human browser vs agent authority |
| Writes | Proposal default; standing rule exact category/source; expected revision; duplicate request; rejected proposal not active |
| Authority | Model cannot self-confirm/promote; locked source cannot be edited; source uncertainty preserved |
| Sensitive data | Credentials prohibited; sensitive opt-in absent; local classifier ambiguity blocks; no cloud triage leak |
| Retrieval | Authorization before reveal/ranking; bounded incomplete search; no unauthorized counts; Arabic/Chinese/Russian normalization fixtures |
| Injection | Remembered text cannot grant tools/skip verifier/change scope; pinned/authoritative data still not action policy |
| Conflict/edit | Equal-authority contradiction surfaced; merge cannot erase provenance; concurrent correction/supersession |
| Privacy | Canary absent from events/receipts/logs/renderer persistence/FTS/temp; protected tags/query/vector derivatives |
| Context/children | Scoped shard only; no sibling/parent memory leak; cloud transfer denied; retrieval handle revoked |
| Retention | Expiry/clock rollback; disabled reads/writes; pinned does not block delete; finite temporary retention |
| Forget/delete | Immediate suppression; partial cleanup journal; known derivative coverage; source conversation not silently erased |
| Erasure honesty | Old wrapped keys in backups; WAL/temp/exports/remote limits; no unsupported permanent-delete label |
| Restore | Newer suppression ledger applied before activation; missing ledger blocks; old index cannot resurrect hit |
| Races | Reveal/dispatch vs forget; stale cache generation rejected; in-flight remote disclosure reported honestly |
| Recovery | Fault/kill at write/deletion/index boundaries; replay cannot recreate erased body; no duplicate write/model call |
| Index future | Rebuild authorization; model/dimension generation mismatch; cross-scope leakage and stale hit rejection |
| Verification | Missing memory-derived evidence invalidates applicability rather than fabricating/reopening terminal completion |
| Export/import | Exact selection/grants; encrypted package; imported authority not blindly trusted; no credentials/path leakage |

Use synthetic sensitive canaries and temporary protected stores. Test actual persisted bytes/derivative stores and runtime behavior—not only visible UI state. External/storage forensic claims require independent validation beyond these local functional tests.

## 25. Implementation and acceptance gates

### G1 — Scope/authority/proposals

- [ ]  Valid scope/grant combinations, authority/confidence, source lineage, and write rules reviewed.
- [ ]  No automatic sensitive/global capture or model self-promotion.

### G2 — Protected local storage and retrieval

- [ ]  Atomic revisions/receipts, protected metadata, bounded authorized search and generation checks implemented.
- [ ]  No plaintext FTS/vector/renderer duplicate introduced.
- [ ]  Four-language retrieval/UI fixtures and privacy tests pass.

### G3 — Lifecycle and user controls

- [ ]  Edit/conflict/expiry/disable/forget behavior implemented with exact semantics.
- [ ]  Parent/child context and provider privacy boundaries remain intact.

### G4 — Deletion and restore

- [ ]  Immediate suppression, known-copy cleanup journal, tombstones, and honest coverage report tested.
- [ ]  Backup/key/ledger/restore policy accepted; unavailable guarantees not advertised.
- [ ]  Fault recovery cannot resurrect erased content.

### G5 — Evidence and integration

- [ ]  Registry/schema/IPC/capability amendments reviewed; generated bindings committed.
- [ ]  Runtime/graph/verification/audit/isolation gates remain green on tested revision/platforms.
- [ ]  Real-data protection and known residual risks documented; required failed/skipped checks remain blockers.

Completion of P0-12 establishes the validated initial governed local memory profile—not universal digital-twin ingestion, unlimited cross-project learning, forensic media erasure, or compliance certification.

## 26. Stop conditions and next artifact

Block reads/writes/transfers when scope/grants/protection are uncertain, source authority conflicts, sensitive-category consent is absent, deletion generations/ledger cannot be trusted, index protection is inadequate, or a provider transfer would violate policy.

Preserve structural evidence and immediate suppression. Do not store plaintext, restore deleted facts from conversation by inference, grant global access, leak content to classify it, ignore stale cache/index hits, or call partial cleanup permanent deletion.

The next specification is **P0-13 — Skills and MCP capability contract**: scoped lazy discovery, instruction trust, tool schema loading, connection/authentication identity, individually enabled tools, exact policy/sandbox routing, result limits, lifecycle/revocation, and prompt-injection/supply-chain tests. Skills and MCP do not gain memory access merely by being installed.