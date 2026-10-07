<aside>
🧩

The trusted graph service owns dependencies, scheduling, and node transitions. Managers and models submit proposals; isolated child sessions perform bounded work and return structured artifacts. A child report is not a verified result, and several successful children do not automatically make the parent task complete.

</aside>

## Purpose and implementation boundary

Define Adham’s first durable task DAG and isolated child-session delegation: graph contracts, legal transitions, readiness, leases/fencing, capability and budget subdivision, focused context, reports, artifact integration, verification-aware joins, cancellation, replanning, and recovery.

Prerequisites: the single-agent runtime, provider gateway, governed tools/sandbox, and completion gate must pass their applicable acceptance tests. This document does not authorize spawning agents in the current workspace, executing tools, adding remote services, installing dependencies, or granting new authority.

### Initial supported graph

One project-scoped DAG, owned by one parent task/run/session, with bounded worker nodes and deterministic joins. Child work occurs in separate sessions/runs with explicit contracts and snapshot inputs. Coding children produce proposals by default; a single controlled integration path applies approved patches and verifies the combined candidate.

Excluded initially: cross-project graphs, shared mutable agent memory, recursive autonomous delegation, distributed/network schedulers, arbitrary cycles, speculative side-effect races, automatic publishing, and durable organization-wide workflows.

### Governing specifications

- P0-07 — Agent runtime state machine.
- P0-08 — Provider gateway and normalized stream contract.
- P0-09 — Tools, policy, and sandbox execution contract.
- P0-10 — Verification gate and evidence-backed completion contract.
- P0-02 — Canonical event taxonomy & schema.
- P0-03 — SQLite event store, content & projections.
- P0-04 — Typed IPC, capabilities & frontend sync.
- P0-05 — Project-isolation threat model.

## 1. Core invariants

1. Canonical events—not manager prose, UI arrows, or in-memory futures—define graph/node state.
2. Graph and child identities are immutable and project-scoped. Organizational role never broadens data access.
3. Only the trusted graph service validates proposals and commits graph transitions.
4. A node starts only after its declared prerequisites, grants, budgets, input contracts, and current revision are satisfied.
5. Each execution assignment has a stable DelegationId and distinct NodeExecutionId, child RunId, and fencing epoch.
6. Lease expiry fences ownership; it does not prove that a child or its side effects stopped.
7. Child authority is no greater than the intersection of parent-delegable authority, project policy, reviewed child requirements, and current restrictions.
8. A child receives a selected immutable context shard, not parent mutable state or an entire transcript by default.
9. Parent/child/sibling context and provider state cannot mix through caches, registries, events, artifacts, or callbacks.
10. Budgets are allocated and charged through one hierarchy; delegation cannot multiply available money/tokens/time or reset limits.
11. A structured child report remains untrusted content until validated against the child contract and trusted evidence.
12. Node success requires an applicable P0-10 verification verdict. Parent completion requires its own integration and acceptance checks.
13. No stale child result, graph revision, or driver epoch can overwrite newer state or terminal outcomes.
14. Replay reconstructs state without spawning children, invoking tools, or repeating patches.
15. Graph cancellation settles/reconciles all descendants before claiming safe completion of the stop operation.

## 2. Objects, identities, and persistence ownership

| Object | Meaning |
| --- | --- |
| TaskGraph | Versioned DAG owned by a parent TaskId/RunId/SessionId |
| NodeDefinition | Immutable revision of objective, inputs/outputs, requirements, resource footprint, and completion contract |
| EdgeDefinition | Typed prerequisite and artifact transfer relationship |
| NodeExecution | One bounded attempt to satisfy a node definition with a distinct child run or trusted service execution |
| DelegationContract | Frozen assignment/context/capability/budget/report/verification agreement |
| ChildSession | Isolated conversation/inbox and event history for a worker |
| NodeLease | Scheduler ownership epoch and expiry for one execution assignment |
| InputBinding | Validated reference to exact upstream output/candidate revisions |
| ResultEnvelope | Bounded child report plus artifacts/evidence/uncertainty references |
| JoinDefinition | Reviewed dependency/result aggregation rule |
| IntegrationCandidate | Combined output/patch set evaluated by the parent verifier |

Typed backend IDs: GraphId, NodeId, EdgeId, GraphRevision, NodeDefinitionRevision, NodeExecutionId, DelegationId, LeaseId, NodeEpoch, and JoinId. Reuse P0-07/10 task/run/session/operation/candidate/evidence identities.

**Initial stream model:** graph facts live in the owning parent session stream; child runtime facts live in each child’s session stream. Do not introduce a graph stream kind or change existing event-envelope semantics without a separate registry/storage amendment.

Graph/node projections are rebuildable. Admission transactions may update parent and child streams in the same SQLite transaction where necessary for atomic child creation, budget allocation, and assignment linkage. Use expected sequences for all touched streams and an approved unit-of-work port; never independently commit half the relationship.

Child session creation reuses domain services without exposing generic session/actor creation to the renderer. Cross-session reporting is a trusted bounded handoff—not a shared event append capability.

## 3. Graph definition and proposal validation

A graph proposal is protected, typed intent containing parent contract reference, nodes, edges, joins, scope, required outputs, and resource/budget plans.

Trusted validation checks:

- parent ownership/authority and expected GraphRevision;
- bounded node/edge counts and stable unique IDs;
- every referenced node/input/output exists and type/schema agrees;
- no self-edge or directed cycle;
- all required outputs reachable from eligible source nodes;
- every executable node has a frozen DelegationContract/CompletionContract;
- no unapproved capability/data/provider/budget expansion;
- conditional branches and joins are declared and deterministic;
- resource conflicts and admission limits are satisfiable;
- parent criteria are covered without replacing mandatory work with optional nodes;
- required terminal output/integration path exists.

Models may propose changes but cannot write node states directly. A visual graph editor uses the same domain commands and policy checks as model proposals.

Node kinds initially:

- worker: isolated agent child run;
- review/verification: scoped trusted verification service or advisory reviewer with explicit semantics;
- integration: controlled artifact/patch combination followed by verification;
- join: pure deterministic prerequisite/output validation, no hidden tool execution.

A reviewer agent’s approval is advisory unless the contract requires that review activity; it cannot independently authenticate checks or mark another worker passed.

## 4. Graph lifecycle and terminal outcomes

Lifecycle: draft → ready → running; running may become pausing, paused, canceling, recovering, or blocked; terminal has a separate immutable outcome.

Graph terminal outcomes: completed, completed-with-warnings, failed, failed-verification, canceled.

| Transition | Conditions |
| --- | --- |
| draft → ready | Definition/contracts/budgets/authority accepted; no effects |
| ready → running | Scheduler epoch acquired; parent control intent and policy permit admission |
| running → pausing → paused | Stop admission; all active children/operations settle to safe paused boundaries |
| nonterminal → canceling → terminal/canceled | Persist cancel, propagate to descendants, reconcile effects, settle ledger |
| active → recovering | Owner interrupted/fenced; inspect durable children/leases/effects |
| running → blocked | No legal progress while required authority/input/evidence/capacity resolution missing |
| blocked/paused → running | Explicit reviewed resolution/resume; fresh current restrictions and budgets |
| running → terminal/success | Required nodes/joins/integration AND parent P0-10 verdict pass |
| running → terminal/failure | Failure policy resolves, all work safely settled, no permissible continuation |

Graph status does not replace parent Run lifecycle. Commit mapped parent state/control intent with graph facts so projections cannot simultaneously claim a completed parent and an active required graph. Terminal states do not reopen.

## 5. Node definition versus execution state

NodeDefinition revisions describe work; NodeExecution represents one lifecycle. Avoid reopening a terminal child RunId merely to retry a node.

Execution states:

pending → ready → leased → running → awaiting-result → verifying → succeeded / succeeded-with-warnings / failed / failed-verification / canceled

Additional nonterminal states: blocked, pausing, paused, recovering. skipped is a terminal disposition only for a proven predeclared branch exclusion or approved optional-node policy; it is never success.

| Edge | Guard/effect |
| --- | --- |
| pending → ready | Prerequisites satisfied, exact inputs bound, applicability true |
| ready → leased | Atomic assignment, budget allocation, epoch/lease, child identity reservation |
| leased → running | Durable child run exists and actual driver admission allowed |
| running → awaiting-result | Child work settled; complete report/result references committed |
| awaiting-result → verifying | Report schema/scope/candidate/evidence valid; P0-10 check plan admitted |
| verifying → succeeded | Applicable child verdict passes and output contract satisfied |
| verifying → succeeded-with-warnings | All mandatory requirements pass; only permitted warnings |
| any active → recovering | Ownership/control lost; do not assume effects stopped |
| pending/ready → skipped | Frozen applicability predicate proven false; mandatory parent coverage still satisfied |
| active → failed/failed-verification | Observed failure classified; effects settled and retries resolved |
| active → canceled | Durable cancel intent and settlement/reconciliation completed |

P0-07 child run states remain authoritative for the runtime. Map them explicitly: a child run may be terminal/completed before its graph handoff is validated, so the node stays awaiting-result/verifying until acceptance. Conversely a report’s success field cannot force child runtime completion.

Node retry creates a new NodeExecutionId and child RunId linked to previous execution/finding under the same NodeDefinition revision. No reset of node/graph budgets or implicit reuse of old lease. Default automatic node reruns/remediation is zero unless a contract explicitly bounds them.

## 6. Edges, readiness, and deterministic joins

Each edge declares prerequisite status, exact output binding, required/optional/conditional applicability, freshness requirements, and failure propagation.

Initial default is **all-required verified-success**. A successor becomes ready only when all applicable required predecessors have succeeded with accepted current outputs. Permitted warnings are compatible only when the successor/parent contract allows them.

No dataflow from failed, canceled, stale, unverified, or skipped required predecessors. Diagnostic failure artifacts may be provided only to a separately contracted remediation/diagnostic node; they are not normal success inputs.

Supported first joins:

- all-required: every applicable required input accepted;
- declared-branch: a trusted frozen branch predicate selects exactly the documented applicable path;
- optional-result collection: preserve optional-node failures/warnings without weakening mandatory coverage.

Any-of/quorum/racing-success joins and speculative side-effect branches are deferred. Do not implicitly treat the first model report as the winner or cancel other billable/effectful children without a reviewed protocol.

InputBinding pins upstream NodeExecutionId, accepted CandidateId/artifact revision, schema, provenance, and authorized content scope. A dependency definition change or output invalidation blocks successor readiness and invalidates affected downstream evidence conservatively.

An edge transfers only explicitly authorized artifact content. A graph edge is not a filesystem, memory, provider-account, or tool grant.

## 7. Delegation contract

Required fields:

- parent graph/node/revision and task/run/session identity;
- child role and immutable reviewed agent definition version;
- objective and focused acceptance criteria;
- delivery mode, default proposal-only for coding workers;
- input context shard and baseline/snapshot references;
- output/report schemas and target artifact constraints;
- capability/root/provider/account/privacy restrictions;
- resource locks and sandbox/profile requirements;
- reserved budget slice, deadlines, allowed retry/remediation count;
- control propagation and orphan policy;
- completion/verification contract and evidence requirements;
- reporting interval/output limits and escalation rules.

Contract acceptance creates no new global authority. A child cannot install tools, change settings, spawn grandchildren, approve its own patch, modify parent state, or broaden context.

Parent grants must be marked delegable and explicitly narrowed. Nondelegable human approvals and broad task consent are not automatically inherited as child grants. Any child-specific approval names the exact action/child scope under P0-09.

## 8. Context isolation and handoff

Build each child’s ContextShard through the trusted context port:

- minimum objective/instructions;
- selected authorized source excerpts/artifacts with provenance and authority;
- exact relevant prior outputs, not an entire parent transcript;
- frozen baseline/config and permitted constraints;
- child contract/report requirements.

Do not include unrelated project history, sibling private conversation, parent hidden mutable state, credentials, raw host paths, or all installed skills/tool schemas.

Child instructions/context are protected content; structural events store references. Retrieval/cache keys include full project/session/run/agent identity and shard revision. Same model/provider/account never implies shared conversation or memory.

Parent receives only approved result/progress artifacts and safe status. Direct access to a child’s full transcript is a separate scoped permission—not implied by manager role. Cross-child communication occurs through validated graph output handoffs; no shared mutable scratch map.

Parent-local-only tasks cannot delegate to cloud workers. Provider selection in the child must satisfy both child and ancestor privacy restrictions; a manager cannot approve local-to-cloud on behalf of the human unless explicit policy grants that authority.

Context resharding/amendment creates a new protected version and explicit node contract/input revision. It does not mutate an active provider request or silently replace old input.

## 9. Child creation and scheduler admission

In one approved transaction:

1. Validate graph/node/revision, prerequisites, parent control intent, current policy, and resource availability.
2. Allocate NodeExecutionId/DelegationId and reserve child session/task/run identities.
3. Freeze delegation contract, inputs, capability subset, and budget allocation.
4. Create scoped child session/task/run via trusted domain services.
5. Append assignment/creation facts and update node/budget/queue projections.
6. Commit an idempotent delegation receipt.

Start driver effects only after commit. A lost acknowledgement followed by the same RequestId/DelegationId returns the existing assignment; no second child is created. Same ID with changed input/scope conflicts.

P0-07 permits one driver per session; separate child sessions therefore do not violate that rule. Parent/child drivers have distinct epochs, inboxes, cancellation signals, and active operation identities.

Waiting parents must not occupy scarce model/sandbox execution slots. Record a reviewed parent waiting-on-graph reason, then release operation capacity while retaining durable ownership. Add this typed reason/projection mapping to P0-07 before implementation; do not pretend an active parent model call can wait indefinitely while using the entire child admission pool.

## 10. Leases, fencing, and fairness

Lease metadata binds GraphId/NodeId/NodeExecutionId, scheduler identity/epoch, child identity, expiry/renewal revision, and operation authority.

Suggested local scheduling baseline: 30-second lease interval with renewal at most every 10 seconds. Values are configuration/test constants, not proof of process liveness or termination. Clock anomalies trigger reconciliation rather than authority extension.

All state/effect admission callbacks check graph revision, NodeEpoch, child driver epoch, active execution, and current control intent. Renewal cannot restore a revoked/stale epoch.

On lease expiry:

- fence old owner from new admissions/results;
- mark recovering;
- inspect the existing child run/process/effect journal;
- settle/reconcile before considering a replacement execution;
- never blindly launch another child on the assumption the old one stopped.

Resource fairness is deterministic among ready nodes using dependency order, policy priority, and round-robin graph/project admission. Starvation/no-progress metrics are separate from leases. Renewed heartbeats alone do not count as task progress.

## 11. Hierarchical budgets and concurrency

Suggested initial bounds:

| Limit | Baseline |
| --- | --- |
| Nodes per graph | 64 |
| Edges per graph | 256 |
| Active worker children per graph | 2 |
| Active worker children per installation | 4, subordinate to global runtime/provider limits |
| Delegation depth | 1: manager → worker; workers cannot delegate |
| Structured report metadata/body | 64 KiB, large outputs referenced as protected artifacts |
| Ready/pending assignments | Bounded by graph/node counts and global admission policy |
| Automatic node retry/remediation | 0 unless explicitly contracted |

Existing P0-09 sandbox cap of two still applies. More worker sessions do not permit more active sandbox/model operations than ancestor/global policy allows.

BudgetLedger rules:

- Parent graph envelope includes manager, workers, reviewers, joins/integration, and final verification.
- Allocate child slices atomically before admission; allocations are reservations, not duplicate spending records.
- Actual child charges settle their allocation and roll into ancestor aggregate exactly once using scoped operation ledger entries.
- Parent available capacity subtracts outstanding allocations/reservations plus settled use without double counting.
- Unknown provider/tool usage retains conservative reservations; canceled/crashed children do not become free.
- Reserve capacity for integration/verification so fan-out cannot spend the whole envelope before required checks.
- Child hard caps, absolute deadlines, and privacy policy cannot exceed ancestors; no child authority to extend its slice.
- Manager waiting time may not consume active model execution time, but graph absolute expiry continues.
- Sum-of-child-work accounting can exceed wall-clock duration under parallelism; record active-work and elapsed/expiry dimensions separately.
- Reallocation requires current authority, known reservations/effects, and durable amendments; restarting/replanning does not reset any ceiling.

A budget amendment accepted for one child does not silently enlarge the parent/global budget.

## 12. Coding worker isolation and integration

Each coding child receives a separate approved staging snapshot and artifact namespace. No two workers write the live repository or each other’s writable staging.

Workers return proposal patches against exact baseline manifests. Their own verification applies to those candidates; it is not proof that the patches compose.

Integration procedure:

1. Collect only accepted verified worker outputs from current node executions.
2. Validate baseline/candidate/provenance/scope and read/write footprints.
3. Detect overlapping edits and semantic/dependency conflicts; disjoint filenames alone do not prove independence.
4. Build a new combined protected IntegrationCandidate through reviewed merge logic.
5. If conflicts require changed content, create a new candidate and invalidate impacted evidence; never silently auto-resolve by overwriting.
6. Run parent-required integration/acceptance checks under P0-10 on the combined candidate.
7. If delivery mode is apply-and-verify, obtain exact P0-09 patch authority and broker-apply with current live preconditions.
8. Verify observed application equivalence and any required live/native behavior before parent completion.

Patch approval belongs to the combined exact artifact, not the earlier individual child patches by inference. Stale targets stop/rebase with renewed evidence/approval. No automatic rollback/reset discards user work.

A proposal-only graph can complete with the verified combined proposal and explicit not-applied handoff. Applying, committing, pushing, publishing, or releasing is not authorized by graph success.

## 13. Progress and result report contract

Progress reports are bounded safe metadata: child identity, phase, completed criterion/check counts, budget certainty, blocker/approval reason, and protected artifact references. Private content is not broadcast to parent/siblings in notifications.

ResultEnvelope includes:

- schema/contract/node-definition revision;
- exact parent/child/node-execution identity;
- outcome claimed by child and trusted runtime terminal reference;
- delivery mode and candidate/baseline/output references;
- criterion coverage and trusted verification/evidence references;
- observed effects and unresolved uncertainty;
- warnings, skipped/blocked checks, tested environments/limitations;
- usage/reservation settlement status;
- concise protected handoff summary.

The trusted report validator confirms scope, schemas, referenced artifacts, authorization, result completeness, applicable P0-10 verdict, and matching current execution. It does not trust a child’s embedded passed=true field or green prose.

Report submission is idempotent. A duplicate identical report adds no second result; changed content with the same receipt ID conflicts. Later corrected reporting is a versioned new submission and cannot rewrite terminal/evidence facts.

Large artifacts stay protected and scope-filtered. A parent may receive a report without gaining ambient access to every source file or underlying child memory.

## 14. Verification-aware joins and parent completion

A node’s success requires its own contract, but the parent contract remains independent.

Join checks:

- all applicable required inputs satisfied;
- exact accepted output revisions/types available and authorized;
- no required upstream failure/cancellation/stale evidence;
- no unsettled side effects or stale lease/result;
- allowed warnings preserved without laundering mandatory failures;
- integration output candidate built and criterion coverage maintained.

Parent completion requires every mandatory parent criterion, including combined integration/native/security/preservation checks where applicable. Averaging child confidence, counting succeeded nodes, or accepting a majority of child reports is prohibited.

Optional-node failures are warnings only if the parent contract explicitly permits them and they did not compromise a required output or hard safeguard. Branch exclusions require proven frozen predicates, not after-the-fact relabeling of failed work as optional.

Final graph verdict and parent run CompletionDetermination commit under P0-10 race/idempotency rules. Required active descendants, pending approvals, unknown effects, and unresolved ledger reservations prevent a false complete state. A deliberately permitted non-effect uncertainty must be named in the exact parent contract/accounting policy; it cannot hide tool effect uncertainty.

## 15. Failure propagation and bounded replanning

Default required-node failure policy:

- stop admitting its dependent nodes;
- retain unrelated settled outputs;
- hold new graph work while classifying failure and parent control/contract policy;
- settle active effects and mark graph blocked or fail according to explicit policy;
- cancel remaining children if the graph is terminating; do not abandon them.

A preapproved continue-independent-branches policy may allow unaffected work within budget. It cannot make a failed required branch successful or ignore security incidents.

Replanning is a model/human proposal validated by the graph service. Amend only pending/unstarted definitions by default. Active nodes must first be paused/canceled and reconciled; terminal executions remain immutable. Changed node contracts/edges/outputs produce a new GraphRevision and invalidate impacted downstream inputs/evidence.

Adding nodes, broadening scope/capabilities, changing mandatory requirements, or increasing budgets needs explicit authority. No endless dynamic fan-out or implicit cycle creation. Repeated replans consume configured progress/budget limits.

Retry/remediation uses new NodeExecutionId/RunId and an explicit finite policy. A failure history is not deleted. Replacing a failed node with an easier objective is a contract/scope amendment, not a successful retry.

## 16. Deadlock, livelock, and no-progress detection

A valid DAG can still stall through resource locks, approvals, child dependencies, or exhausted budgets. Detect these separately:

- definition cycles rejected before commit;
- required inputs unavailable/stale;
- resource wait graph cycles/lock order violations;
- parent holding resources children need;
- all remaining nodes waiting on expired approvals/unsupported profiles;
- lease-renewing children with no substantive progress;
- repeated equivalent graph proposals or failed replacement executions.

Acquire resource locks in deterministic order; release execution slots when waiting. Do not let a child wait for a parent-held exclusive project lock that the parent retains while awaiting the child.

Default no-progress rules inherit P0-07 and add graph-level progress: accepted node result, settled effect, verified criterion, or valid input/approval resolution. New prose, heartbeat, reordered plan, or another lease does not count.

On detected stall, checkpoint/block with concrete wait dependencies and safe next choices. Do not forcibly drop authorization checks, reset counters, skip required nodes, or silently cancel useful work to display progress.

## 17. Pause, cancel, revocation, and orphan handling

### Graph pause

Persist graph/parent pause intent, stop child admission, and propagate pause to active child runs. Enter paused only when children and tools are at confirmed safe boundaries. A child still pausing keeps the graph pausing. Queued assignments remain held; no background fan-out proceeds after pause.

### Graph cancel

Persist cancel, stop admission/retries/replans, propagate to all descendants, revoke transient delegation grants, settle contained processes/patches/provider outcomes and budget reservations, then record canceled with explicit observed uncertainty as permitted by runtime rules. No automatic rollback of applied files.

A child cancel result cannot override an already committed parent cancel with success. Canceling one child does not implicitly cancel independent siblings unless graph policy says so; dependent readiness is recalculated.

### Revocation/security incident

New restrictive policy applies across descendants immediately for admission. Signal stop for affected active effects, quarantine the relevant profile/grant, and preserve structural evidence. Parent authority cannot regrant itself the revoked capability.

### Orphan policy

Initial default: if parent graph control ownership cannot be recovered safely, hold/stop child work and reconcile; do not continue autonomously or reparent it silently. A lost manager model call is not necessarily lost graph authority—the trusted scheduler owns the graph—but scheduler/process loss requires recovery/fencing.

No detached child can retain indefinite authority, free budget, or a live process without a reconciled owner. Continuation policies are a future explicit scoped feature.

## 18. Crash recovery

1. Acquire graph scheduler ownership and fence previous epochs.
2. Verify parent and linked child stream integrity/compatibility; rebuild projections without effects.
3. Reconcile delegation receipts and child existence; reject/quarantine inconsistent linkage rather than inventing missing state.
4. Classify leased/running nodes by actual existing child run/process/operation state.
5. Honor prior pause/cancel/revocation before any new admission.
6. Reconcile uncertain effects and budget reservations under P0-07–09.
7. Validate accepted reports/artifacts and P0-10 applicability; stale/deleted evidence blocks use.
8. Recompute readiness from current validated inputs and GraphRevision.
9. Hold recovered graphs paused by default; explicit resume rechecks authority/budgets.
10. Commit recovery decisions before creating any replacement child/effect.

Crash windows include assignment transaction, child driver startup, lease renewal, tool effect, child completion before report, report before node acceptance, integration before verification, and parent terminal commit before response delivery.

Lost response retries query the same delegation/result receipts. Exactly-once local linkage does not imply exactly-once provider compute or filesystem effects. Expired leases never justify repeating an unknown operation.

## 19. Example first graph

Example objective: produce a verified bounded desktop change without losing unrelated work.

```
A: trusted baseline/contract capture
├── B: worker proposes backend/API change against snapshot A
└── C: worker proposes UI/localization change against snapshot A
B + C → D: validate reports and combine candidate
D → E: integration/behavior/security/native verification
E → F: handoff proposal, or separately approved broker-apply + equivalence checks
F → parent CompletionDetermination
```

If B changes a transport schema needed by C, freeze that dependency explicitly: either B’s accepted schema precedes C, or D reconciles/reverifies the interface. Do not claim parallel independence merely because files differ.

B/C child results are proposal-only by default. E uses trusted verification capture—not an autonomous reviewer saying everything looks correct. Missing required native evidence blocks the parent; it cannot be replaced by both workers reporting success.

## 20. Events, projections, and IPC amendment

Extend the reviewed P0-02 registry with versioned graph/node/edge amendment, readiness/lease, delegation, report, integration, control, and recovery facts. Existing reserved families include graph/created, graph/node-added, graph/node-status-changed, agent/delegated, and agent/report-submitted.

Each event carries relevant typed IDs/revisions/epochs, safe state/reason, resource counts, input/output/protected references, and causation. Never include full objectives, prompts, reports, diffs, raw paths, or credentials in structural payloads.

Node acceptance/child linkage transactions align with runtime verification/terminal facts rather than creating competing authority. Unknown future graph/report versions block affected scheduling/joins safely.

Projections: graph topology/current revision, node execution history, readiness/wait reasons, child activity, leases, budget allocation/usage, report acceptance, integration/evidence coverage, and control settlement.

Proposed application commands: ProposeGraph, AcceptGraphRevision, StartGraph, PauseGraph, ResumeGraph, CancelGraph, RequestNodeRetry, GetGraphState, and GetChildReportPage. All mutations are idempotent, compare revisions, resolve trusted actor/scope, and obey policy.

These are not authorized Tauri endpoints until P0-04 DTOs/permissions/limits/error mappings/generated contracts and tests are amended. No SetNodeSucceeded, SpawnArbitraryAgent, DelegateAllCapabilities, or generic graph-script endpoint is allowed. Notifications contain exact-scope invalidation only.

## 21. Rust ownership and modules

```
crates/adham-graph/src/
├── lib.rs
├── domain/
│   ├── graph.rs
│   ├── node.rs
│   ├── edge.rs
│   ├── join.rs
│   ├── readiness.rs
│   ├── transition.rs
│   └── lease.rs
├── application/
│   ├── validate.rs
│   ├── schedule.rs
│   ├── integrate.rs
│   ├── replan.rs
│   └── recover.rs
└── ports/
    ├── persistence.rs
    ├── delegation.rs
    ├── verification.rs
    └── resources.rs

crates/adham-agents/src/
├── domain/              definitions, delegation and report contracts
├── application/         child admission, scoped context and reporting
└── ports/               runtime/context/policy/artifact services
```

adham-graph owns DAG correctness and scheduling; adham-agents owns reviewed definitions/delegation contracts; adham-runtime executes child runs; adham-policy authorizes narrowed grants; adham-verify determines criterion success. No graph/model component writes child database rows directly or constructs concrete provider/tool clients.

Cross-context wiring belongs in the trusted composition root. Pure graph reducers/topological validation have no IO. Time/lease/resource policy is injectable for tests. Do not add network microservices or generic distributed scheduler dependencies for a local desktop DAG.

Create only used modules/dependencies under P0-06 review. Target production files under 300 lines; review above 400; require documented exceptions above 600.

## 22. Required test matrix

| Area | Required evidence |
| --- | --- |
| DAG validation | Cycles/self-edges/dangling IDs; bounded graph; typed input/output mismatch; unreachable mandatory criterion |
| Transition legality | Every allowed/forbidden node/graph edge; terminal immutability; child vs node status mapping |
| Readiness/joins | All-required success; declared branch applicability; failed/stale/skipped predecessor blocked; warning policy preserved |
| Child isolation | Separate session/context/cache/grants/artifacts; sibling/parent private state denied |
| Delegation authority | Capability subset; nondelegable approvals; revoked grant; local-to-cloud child denied; no recursion |
| Atomic linkage | Fault at child creation/budget/assignment transaction; duplicate delegation returns same child |
| Leases/fencing | Expiry does not redispatch uncertain work; stale epoch/outcome rejected; owner renewal race |
| Budget | Allocation/usage not double counted; unknown reservation retained; cancel/replan/restart no reset; final verification capacity |
| Scheduling | Parent waits without holding child slots; lock-order/deadlock; fairness; global sandbox/concurrency caps |
| Report validation | Forged success/evidence; wrong scope/revision/candidate; duplicate/conflicting report; protected content limits |
| Integration | Overlapping/semantic patch conflict; combined candidate reverified; stale live target; no silent merge/rollback |
| Completion | Green children cannot bypass parent criteria; required native check missing; optional failure cannot weaken required join |
| Controls | Pause/cancel fan-out stops admission; descendants settle; orphan handling; revocation/late-result races |
| Recovery | Kill at assignment/start/report/join/integration/terminal boundaries; replay spawns zero work; no duplicate patch/child |
| Replanning | Active nodes settled first; graph revision invalidation; mandatory scope cannot be silently removed; finite retries |
| Privacy | Objectives/reports/paths absent from events/logs/notifications; scoped authorized retrieval and cloud-transfer policy |
| Compatibility | Unknown graph/report/checkpoint versions stop scheduling safely; historical bytes unchanged |

Property tests generate bounded DAGs, mutations, lease/control races, and report sequences. Assert no ready node has an unsatisfied required prerequisite, no accepted result belongs to a stale execution, and ledger availability never increases through restart/replay.

Use deterministic child fakes for reducer tests and native/process-kill integration with synthetic isolated projects for actual runtime/sandbox evidence. Do not claim real child isolation from mocked events alone.

## 23. Implementation and acceptance gates

### G1 — Graph core

- [ ]  Definition/schema, transition, cycle/readiness/join and revision semantics accepted.
- [ ]  Pure/property tests pass before child spawning.

### G2 — Delegation and budget boundary

- [ ]  Context/capability subset and report contracts reviewed.
- [ ]  Atomic parent/child linkage, ledger allocation, scheduler wait-capacity release, and idempotency tested.
- [ ]  No recursive/cross-project/shared-mutable authority introduced.

### G3 — Scheduler and recovery

- [ ]  Leases/epochs/resources/fairness and no-progress detection tested.
- [ ]  Crash/expiry reconciliation precedes replacement work; pause/cancel/revocation survives restart.

### G4 — Integration and verification

- [ ]  Child reports require trusted applicable evidence.
- [ ]  Combined candidate and parent criteria verified independently.
- [ ]  Proposal/application modes and exact patch authority remain distinct.

### G5 — Native evidence and handoff

- [ ]  Actual project/session/grant isolation tested on declared validated platforms.
- [ ]  Contract/registry/IPC amendments reviewed; generated types committed.
- [ ]  All audit/privacy/boundary/runtime/sandbox/verification gates remain green.
- [ ]  Evidence records graph revision, child execution versions, budgets/unknowns, tested platforms, and unvalidated features.

Completion of P0-11 means the validated first graph/delegation model is safe and recoverable within its stated profile—not unlimited multi-agent autonomy or support for arbitrary workflows.

## 24. Stop conditions and next artifact

Stop admission and preserve evidence on a cycle/invalid graph revision, stale lease/result, scope or grant mismatch, exhausted/unreconciled budget, orphaned executable work, unknown mutable outcome, unverified mandatory report, integration conflict, missing containment, or incompatible event/schema.

Do not bypass a blocker by marking a node succeeded, granting all parent tools, restarting children with new identities, dropping a required edge, silently shrinking criteria, resetting budgets, or accepting manager confidence as evidence. Show exact waiting/failure/uncertainty and the minimal safe next decision.

The next specification is **P0-12 — Governed local memory contract**: memory scope, provenance/authority/mutability, retrieval filtering, write proposals/approval, retention/expiry, inspect/edit/export/forget, deletion guarantees and tombstones, protected storage, and isolation tests. Graph and child sessions must not gain persistent shared memory by accident before that contract is accepted.