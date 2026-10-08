<aside>
🧩

Companion to P0-11. Research matrix only — it authorizes no child spawning, tools,
remote services, dependencies, or new authority.

</aside>

# P0-11 — Task graph and subagent wiring matrix with delegation skeleton

## 1. Purpose and boundaries

This document is the research companion to `P0-11 — Task graph and isolated subagent
execution contract`. It answers one question: for each graph and delegation mechanism, which
settings must be wired, which separate files own each piece, and which containment controls
come first.

- **Status:** research only. It does not authorize spawning agents, executing tools, adding
  remote services, installing dependencies, or granting new authority.
- **Scope:** the first durable project-scoped DAG owned by one parent task/run/session, with
  bounded worker nodes and deterministic joins; child work in separate sessions/runs with
  explicit contracts and snapshot inputs; coding children producing proposals by default with
  one controlled integration path. Graphs/subagents begin only after the single-agent runtime,
  provider gateway, governed tools/sandbox, and completion gate pass applicable acceptance.
- **Excluded initially:** cross-project graphs, shared mutable agent memory, recursive
  autonomous delegation, distributed/network schedulers, arbitrary cycles, speculative
  side-effect races, automatic publishing, durable organization-wide workflows.
- **Core maxim:** the trusted graph service owns dependencies, scheduling, and node
  transitions; managers and models submit proposals; isolated child sessions do bounded work
  and return structured artifacts. A child report is not a verified result, and several
  successful children never auto-complete the parent.
- **Data hygiene:** all graphs, budgets, and thresholds are specified values or synthetic
  placeholders. No real delegation data, user content, or machine paths.
- **File-size note:** target under 600 lines; split per family (graph / delegation / recovery)
  before review if it grows past that.

## 2. Shared graph schema

Canonical events — not manager prose, UI arrows, or in-memory futures — define graph and node
state. Graph and child identities are immutable and project-scoped; organizational role never
broadens data access. Only the trusted graph service validates proposals and commits
transitions. Replay reconstructs state without spawning children, invoking tools, or
repeating patches.

### 2.1 Objects and identities

| Object | Meaning |
|---|---|
| `TaskGraph` | Versioned DAG owned by a parent Task/Run/Session |
| `NodeDefinition` | Immutable revision: objective, inputs/outputs, requirements, footprint, completion contract |
| `EdgeDefinition` | Typed prerequisite + artifact transfer relationship |
| `NodeExecution` | One bounded attempt at a node definition (distinct child run or trusted-service execution) |
| `DelegationContract` | Frozen assignment/context/capability/budget/report/verification agreement |
| `ChildSession` | Isolated conversation/inbox + event history for a worker |
| `NodeLease` | Scheduler ownership epoch + expiry for one assignment |
| `InputBinding` | Validated reference to exact upstream output/candidate revisions |
| `ResultEnvelope` | Bounded child report + artifacts/evidence/uncertainty references |
| `JoinDefinition` | Reviewed dependency/result aggregation rule |
| `IntegrationCandidate` | Combined output/patch set evaluated by the parent verifier |

IDs: `GraphId, NodeId, EdgeId, GraphRevision, NodeDefinitionRevision, NodeExecutionId,
DelegationId, LeaseId, NodeEpoch, JoinId`, reusing P0-07/10 task/run/session/operation/
candidate/evidence identities. Stream model: graph facts live in the owning parent session
stream; child runtime facts live in each child's session stream — no new stream kind without
a registry/storage amendment. Admission transactions may span parent + child streams in one
SQLite transaction (expected sequences, approved unit-of-work port — never half a
relationship). Child creation reuses domain services without exposing generic session
creation to the renderer; cross-session reporting is a trusted bounded handoff, not shared
append rights.

### 2.2 Definition validation and lifecycles

Graph proposals are protected typed intent (parent reference, nodes, edges, joins, scope,
outputs, resource/budget plans). Trusted validation: parent ownership/authority + expected
`GraphRevision`; bounded node/edge counts with stable unique IDs; every reference exists with
agreeing type/schema; no self-edge or directed cycle; all required outputs reachable; every
executable node carries frozen delegation + completion contracts; no unapproved
capability/data/provider/budget expansion; declared deterministic branches/joins; satisfiable
resources; parent criteria covered without swapping mandatory work for optional nodes;
required terminal/integration path exists. Models and visual editors propose through the same
domain commands and policy checks — nothing writes node states directly. Node kinds
initially: `worker` (isolated agent child run); `review/verification` (scoped trusted
verification service or advisory reviewer with explicit semantics — advisory approval never
authenticates checks); `integration` (controlled artifact/patch combination followed by
verification); `join` (pure deterministic prerequisite/output validation, no hidden tool
execution).

Graph lifecycle: `draft → ready → running`, with `pausing/paused`, `canceling`,
`recovering`, `blocked`, and terminal outcomes `completed | completed-with-warnings |
failed | failed-verification | canceled`. Graph status never replaces parent Run lifecycle —
commit mapped parent state/intent together so no projection shows a completed parent beside
an active required graph; terminals never reopen.

Node execution: `pending → ready → leased → running → awaiting-result → verifying →
succeeded / succeeded-with-warnings / failed / failed-verification / canceled`, plus
`blocked/pausing/paused/recovering`; `skipped` is terminal only for proven predeclared
branch exclusions or approved optional-node policy — never success. Child P0-07 run states
stay authoritative and are mapped explicitly: a terminal/completed child run still leaves
its node in `awaiting-result/verifying` until handoff acceptance, and a report's success
field can never force child runtime completion. Node retry mints new `NodeExecutionId` +
child `RunId` linked to prior execution/findings under the same definition revision — no
budget/lease reset, no old-lease reuse, zero automatic reruns unless explicitly contracted.

### 2.3 Edges, readiness, joins

Default: **all-required verified-success** — a successor readies only when every applicable
required predecessor succeeded with accepted current outputs; permitted warnings pass through
only where the successor/parent contract allows. No dataflow from failed, canceled, stale,
unverified, or skipped required predecessors (diagnostic failure artifacts go only to
separately contracted remediation/diagnostic nodes). Supported first joins: `all-required`,
declared frozen branch predicates selecting exactly one documented path, and optional-result
collection preserving failures without weakening mandatory coverage. Any-of/quorum/
racing-success joins and speculative side-effect branches are deferred — never crown the
first model report winner nor cancel billable siblings without a reviewed protocol.
`InputBinding` pins upstream execution, accepted candidate/artifact revision, schema,
provenance, authorized scope; definition changes or output invalidation block successor
readiness and conservatively invalidate downstream evidence. An edge transfers explicitly
authorized artifact content only — never a filesystem, memory, provider-account, or tool
grant.

## 3. Delegation wiring matrix

Conventions mirror the earlier matrices: each mechanism names its owner, its durable
records, and its bounds. A node starts only after declared prerequisites, grants, budgets,
input contracts, and current revision are satisfied.

### 3.1 Delegation contract and context shards

Required fields: parent graph/node/revision + task/run/session identity; child role with
immutable reviewed agent definition version; objective + focused acceptance criteria;
delivery mode (coding workers default proposal-only); input shard + baseline/snapshot refs;
output/report schemas + artifact constraints; capability/root/provider/account/privacy
restrictions; resource locks + sandbox/profile requirements; reserved budget slice,
deadlines, retry/remediation count; control propagation + orphan policy; completion/
verification contract + evidence requirements; reporting interval/output limits +
escalation rules. Acceptance creates no global authority: no tool installation, settings
changes, grandchild spawning, self-approved patches, parent-state mutation, or context
broadening. Parent grants must be marked delegable and explicitly narrowed — nondelegable
human approvals and broad task consent never inherit; child-specific approvals name the
exact action/child scope under P0-09.

Context shards are built through the trusted context port: minimum objective/instructions,
selected authorized excerpts/artifacts with provenance, exact relevant prior outputs (never
a full parent transcript), frozen baseline/config/constraints, contract/report
requirements. Excluded: unrelated project history, sibling private conversation, parent
hidden mutable state, credentials, raw host paths, all installed skills/tool schemas.
Instructions/context are protected content with reference-only structural events; cache and
retrieval keys carry full project/session/run/agent identity + shard revision (same model/
provider/account never implies shared conversation or memory). Parents receive approved
result/progress artifacts + safe status only — full child transcripts need separate scoped
permission; cross-child traffic flows through validated graph handoffs, never a shared
mutable scratch map. Parent-local-only tasks never delegate to cloud workers; child
provider selection must satisfy child and ancestor privacy alike. Resharding mints a new
protected version + contract/input revision — never mutates an active provider request.

### 3.2 Child creation, leases, budgets

Atomic admission transaction: validate graph/node/revision, prerequisites, parent intent,
current policy, resources → allocate `NodeExecutionId`/`DelegationId`, reserve child
session/task/run identities → freeze contract, inputs, capability subset, budget slice →
create scoped child session/task/run via trusted domain services → append assignment facts,
update node/budget/queue projections → commit idempotent delegation receipt. Driver effects
start only after commit; same `RequestId`/`DelegationId` on a lost acknowledgement returns
the existing assignment (changed input/scope conflicts). P0-07's one-driver-per-session rule
holds because child sessions are separate, with distinct epochs, inboxes, cancel signals,
and operation identities. Waiting parents release scarce model/sandbox slots while retaining
durable ownership under a typed waiting reason (mapped to P0-07 before implementation).

Leases bind graph/node/execution, scheduler identity/epoch, child identity, expiry/renewal
revision, operation authority. Baseline: 30 s interval, renewal at most every 10 s — test
constants, never proof of liveness or termination; clock anomalies reconcile, never extend
authority. Every admission callback checks graph revision, `NodeEpoch`, child driver epoch,
active execution, current intent; renewal cannot revive revoked/stale epochs. On expiry:
fence the old owner from admissions/results, mark recovering, inspect the actual child
run/process/effect journal, settle/reconcile before any replacement — never blind-launch a
second child on the assumption the first stopped. Fairness is deterministic (dependency
order, policy priority, round-robin admission); heartbeats are not progress.

Budget envelope covers manager, workers, reviewers, joins/integration, final verification.
Slices allocate atomically before admission as reservations (never duplicate spend records);
child charges settle once into ancestor aggregates via scoped ledger entries; parent capacity
subtracts outstanding allocations + settled use without double counting; unknown usage keeps
conservative reservations; canceled/crashed children stay charged; integration/verification
capacity is reserved upfront so fan-out cannot consume the envelope first; child caps,
deadlines, and privacy never exceed ancestors; manager waiting burns no model time but
absolute expiry runs on; parallel work records active-work and elapsed/expiry separately;
reallocation needs current authority + durable amendments; restarts/replans reset nothing,
and one child's amendment never enlarges parent/global budgets. Initial bounds: 64 nodes,
256 edges per graph, 2 active workers per graph, 4 per installation (subordinate to
global/runtime/provider caps), delegation depth 1 (workers never delegate), 64 KiB report
metadata/body (bulk via artifacts), zero automatic node retry/remediation unless contracted.

### 3.3 Coding workers, integration, reports, joins

Each coding child gets a separate approved staging snapshot + artifact namespace — no two
workers share the live repository or each other's writable staging; workers return proposal
patches against exact baseline manifests, and their own verification never proves the
patches compose. Integration: collect accepted verified outputs from current executions →
validate baseline/candidate/provenance/scope + read/write footprints → detect overlapping
and semantic/dependency conflicts (disjoint filenames prove nothing) → build a new combined
protected candidate through reviewed merge logic → conflicts needing changed content mint a
new candidate and invalidate impacted evidence (never silent overwrite resolution) → run
parent-required integration/acceptance checks under P0-10 → broker-apply under exact P0-09
authority only for apply-and-verify, then confirm observed equivalence + live/native
behavior. Patch approval attaches to the combined exact artifact, never inherited from child
patches; stale targets stop/rebase with renewed evidence; no auto-rollback discards user
work; proposal-only graphs complete with verified proposals + explicit not-applied handoffs.

Progress reports are bounded safe metadata (identity, phase, criterion/check counts, budget
certainty, blocker/approval reasons, artifact references — no private content broadcast).
`ResultEnvelope` carries schema/contract/definition revisions, exact parent/child/execution
identity, claimed outcome + trusted runtime terminal reference, delivery mode + candidate/
baseline/output refs, criterion coverage + verification/evidence refs, observed effects +
uncertainty, warnings/skips/blocks, environments/limitations, settlement status, concise
protected handoff summary. The trusted validator checks scope, schemas, artifacts,
authorization, completeness, applicable P0-10 verdict, and current execution — never a
child's embedded `passed=true` or green prose. Submission is idempotent (identical
duplicates add nothing; changed content under one receipt conflicts); corrections arrive as
versioned new submissions that cannot rewrite terminal/evidence facts. Large artifacts stay
protected and scope-filtered.

Verification-aware joins: all required inputs satisfied; exact accepted revisions available
and authorized; no upstream failure/cancellation/staleness; no unsettled effects or stale
leases/results; warnings preserved without laundering mandatory failures; integration
candidate built with coverage intact. Parent completion needs every mandatory parent
criterion including combined integration/native/security/preservation checks — no averaged
confidence, node counts, or report majorities. Optional-node failures warn only where the
parent contract permits without compromising required outputs or hard safeguards. Final
verdict + parent `CompletionDetermination` commit under P0-10 race/idempotency rules with
active descendants, pending approvals, unknown effects, and unresolved reservations all
blocking false completion; only contract-named non-effect uncertainty is permitted.

### 3.4 Failure, deadlock, pause/cancel, recovery

Required-node failure: stop admitting dependents, retain unrelated settled outputs, hold
new work during classification, settle active effects, mark blocked/failed per explicit
policy, cancel remaining children on termination (never abandon). Preapproved
continue-independent-branches may preserve unaffected work within budget but never redeem a
failed required branch or ignore security incidents. Replanning is a validated proposal:
amend pending/unstarted definitions by default; settle active nodes first; terminal
executions immutable; contract/edge/output changes mint new `GraphRevision` and invalidate
downstream; nodes/scope/capabilities/requirements/budgets need explicit authority; no
endless fan-out or implicit cycles; replans consume progress/budget limits; retries use new
execution/run IDs with finite policy and undeleted history; replacing a failed node with an
easier objective is a scope amendment, not a retry.

Deadlock/livelock/no-progress detection (beyond definition cycles rejected at commit):
unavailable/stale required inputs; resource wait-graph cycles and lock-order violations
(acquire locks in deterministic order; release execution slots while waiting; never let a
child wait on a parent-held exclusive project lock the parent keeps while awaiting the
child); approvals/profiles permanently blocking all remaining nodes; lease-renewing
children without substantive progress; repeated equivalent proposals or failed
replacements. Graph-level progress = accepted node result, settled effect, verified
criterion, or valid input/approval resolution — never prose, heartbeats, reordered plans,
or fresh leases. On stall: checkpoint/block with concrete wait dependencies + safe next
choices; never drop authorization, reset counters, skip required nodes, or silently cancel
useful work for the appearance of progress.

Pause: persist graph/parent intent, stop admission, propagate to child runs, enter paused
only at confirmed safe boundaries everywhere (a still-pausing child keeps the graph
pausing); queued assignments held, no background fan-out after pause. Cancel: persist,
stop admission/retries/replans, propagate to all descendants, revoke transient grants,
settle processes/patches/provider outcomes/reservations, record canceled with permitted
explicit uncertainty; no auto-rollback of applied files; committed parent cancel beats any
child success; sibling cancels stay scoped unless policy says otherwise. Revocation applies
new restrictions to descendants immediately for admission, stops affected effects,
quarantines profiles/grants, preserves structural evidence — parent authority cannot
self-regrant revoked capability. Orphans: unrecoverable parent ownership holds/stops child
work with reconciliation — no autonomous continuation, no silent reparenting, no
indefinite authority/budget/process without a reconciled owner (continuation policies are a
future explicit scoped feature).

Crash recovery: acquire scheduler ownership + fence epochs → verify parent/child stream
integrity, rebuild projections effect-free → reconcile delegation receipts and child
existence (reject/quarantine inconsistent linkage, never invent state) → classify
leased/running nodes against actual child/process/operation state → honor prior
pause/cancel/revocation before admission → reconcile uncertain effects + reservations →
validate reports/artifacts + P0-10 applicability (stale/deleted evidence blocks use) →
recompute readiness from current inputs + revision → hold recovered graphs paused by
default with explicit authority/budget-checked resume → commit recovery decisions before
any replacement child/effect. Windows: assignment transaction, child driver startup, lease
renewal, tool effects, completion-before-report, report-before-acceptance, integration
before verification, terminal commit before delivery. Same-receipt retries for lost
responses; local exactly-once linkage never implies exactly-once provider/filesystem
effects; expired leases never justify repeating unknown operations.

Example first graph (verified bounded desktop change): `A` trusted baseline/contract
capture → `B` backend/API proposal + `C` UI/localization proposal against snapshot A →
`D` report validation + candidate combination → `E` integration/behavior/security/native
verification → `F` proposal handoff (or separately approved broker-apply + equivalence) →
parent determination. Cross-worker schema dependencies freeze explicitly (B's accepted
schema precedes C, or D reconciles/reverifies) — parallel file disjointness never implies
independence. Worker successes never substitute for missing required native evidence.

Events/IPC: extend P0-02 with versioned graph/node/edge amendment, readiness/lease,
delegation, report, integration, control, recovery facts (joining reserved
graph/created, graph/node-added, graph/node-status-changed, agent/delegated,
agent/report-submitted); typed IDs/revisions/epochs, safe state/reason, counts,
input/output/protected refs, causation — never objectives, prompts, reports, diffs, raw
paths, credentials. Node acceptance/child linkage aligns with runtime
verification/terminal facts under one authority. Projections: topology/revision, execution
history, readiness/waits, child activity, leases, budget ledger, report acceptance,
integration/evidence coverage, control settlement. Commands: `ProposeGraph`,
`AcceptGraphRevision`, `StartGraph`, `PauseGraph`, `ResumeGraph`, `CancelGraph`,
`RequestNodeRetry`, `GetGraphState`, `GetChildReportPage` — idempotent, revision-compared,
actor/scope-resolved, policy-bound; none authorized as Tauri endpoints before P0-04
DTOs/permissions/limits/errors/bindings/tests. Forbidden: `SetNodeSucceeded`,
`SpawnArbitraryAgent`, `DelegateAllCapabilities`, generic graph-script endpoints;
notifications carry exact-scope invalidation only.

## 4. Delegation safety controls

Delegation multiplies every runtime hazard: spend, authority, context, and blast radius all
fan out with the worker count. Each control below answers a documented failure.

1. **Depth 1 + finite breadth.** Workers never delegate; node retry/remediation defaults to
   zero unless explicitly contracted; replans consume progress/budget limits. Answers
   recursive fan-out: 48 agents on one research query, ~242 cumulative agents burning a full
   usage limit, background agents self-spawning after host exit — all from a harness that
   allowed depth-5 recursion with uncapped breadth. Terminal-researcher prompts (“use tools
   directly, do not call Agent”) are a stopgap; per-session spawn limits with hard ceilings
   and query-dedup registries are the structural fix.
2. **Cap concurrency before budget.** Fan-out cost has no economy of scale: each worker
   re-pays the fixed context tax (brief, rules, schemas, memory) and the coordinator re-pays
   ingest per report (1→8→64→512 workers ≈ $1.20→$9.40→$75→$600 at illustrative rates).
   Budgets check at report time — a 512-fan-out commits spend before the first report
   arrives. Adham rules: 2 active workers per graph, 4 per installation, upfront
   integration/verification reservation, concurrency cap as the velocity control with budget
   as the total control.
3. **No orphans with authority.** Detached children must not retain live processes, budgets,
   or grants without a reconciled owner. Answers: Codex 16 subagents “running” for 4–8 days
   across restarts with no stop/remove control; partial auto-cleanup removing 1–3 while
   invisible remainder blocks launch limits; enterprises averaging 47 ownerless agents still
   firing; Temporal's lesson codified — parent-close policy per child
   (abandon / request-cancel / terminate-default), cooperative cancellation scopes with
   heartbeats, detached-scope cleanup that rethrows so execution ends canceled.
4. **Zombie discipline.** Heartbeat-liveness ≠ task health: Airflow's zombie saga (silent
   scheduler stalls, tasks stuck queued/running across restarts, double-cleanup deadlocks via
   `depends_on_past`, 10 s re-detection races) is the reference failure. Adham rules: lease
   expiry fences and marks recovering but never redispatches uncertain work; stale
   epoch/outcome rejection; owner-renewal races settled by revision comparison; recovery
   classifies against actual child/process state before any replacement.
5. **Deadlock-proof waiting.** Deterministic lock order, slot release while waiting, no
   parent-held exclusive locks awaited by children the parent awaits. Answers wait-graph
   cycles, parent-holds-resources-children-need stalls, and approvals that permanently gate
   all remaining nodes — checkpointed/blocked with concrete wait dependencies, never
   papered over.
6. **Contamination-proof handoffs.** Full-transcript inheritance propagates any parent
   injection to all descendants; shared scratch maps and ambient memory do the same job
   quietly. Adham rules: minimal immutable shards, validated handoffs only, no shared
   mutable maps, LangGraph lesson — shared vs private state keys explicit, subgraphs
   inheriting (not owning) checkpointers, cross-namespace routing explicit.
7. **Join integrity.** Any-of/quorum/racing joins deferred; first-report-wins forbidden;
   combined candidates reverified; averaged confidence, node counts, and report majorities
   prohibited as completion evidence (Airflow trigger-rule lesson: join semantics must be
   declared — all-required vs branch predicates — and evaluated on direct parents only).
8. **Patch authority at the combination.** Approval attaches to the combined exact artifact
   after conflict detection (overlapping + semantic, not filename-disjointness); stale
   targets stop/rebase with renewed evidence; user work never auto-rolled-back.

## 5. Graph skeleton, risk log, sources, and open decisions

### 5.1 Skeleton (names only — no code authorized)

P0-11 contract §21 trees, graph + agents only:

```
crates/adham-graph/src/
├── lib.rs
├── domain/        # graph, node, edge, join, readiness, transition, lease
├── application/   # validate, schedule, integrate, replan, recover
└── ports/         # persistence, delegation, verification, resources

crates/adham-agents/src/
├── domain/        # definitions, delegation + report contracts
├── application/   # child admission, scoped context, reporting
└── ports/         # runtime / context / policy / artifact services
```

Ownership: `adham-graph` = DAG correctness + scheduling; `adham-agents` = reviewed
definitions/delegation contracts; `adham-runtime` = child run execution; `adham-policy` =
narrowed grant authorization; `adham-verify` = criterion success. No graph/model component
writes child rows directly or constructs provider/tool clients; cross-context wiring lives
in the trusted composition root; pure reducers/topological validation are IO-free; time,
lease, and resource policy injectable for tests; no network microservices or generic
distributed-scheduler dependencies for a local desktop DAG. Module/file targets 300/400/600 govern future module sources, not this matrix doc (see its §1 note); only used modules/dependencies under P0-06 review.

Acceptance follows P0-11 G1–G5: graph core (definition/schema/transitions, pure/property
tests before spawning) → delegation + budget boundary (context/capability subsets, atomic
linkage, slot release, idempotency, no recursion/cross-project/shared-mutable authority) →
scheduler + recovery (leases/epochs/fairness/no-progress, reconcile-before-replace,
restart-surviving controls) → integration + verification (trusted-evidence reports,
independently verified combined candidate, distinct proposal/apply modes) → native evidence
+ handoff (real isolation on validated platforms, reviewed amendments, green dependent
gates, revision/version/budget/platform records). P0-11 completion means the validated
first graph/delegation model is safe and recoverable in-profile — never unlimited
multi-agent autonomy.

### 5.2 Risk log (signal → Adham rule)

| # | Signal | Adham rule |
|---|---|---|
| G1 | Recursive fan-out 48–242 agents; post-exit runaway | §4.1: depth 1, zero-default retry, spawn caps, dedup |
| G2 | Linear fan-out spend ($1.20→$600); budget-checked-too-late | §4.2: 2/graph + 4/install caps, upfront verification reserve |
| G3 | 16 stale Codex subagents; 47 ownerless agents/enterprise | §4.3: fenced orphans, per-child close policy, stop controls |
| G4 | Airflow zombie/stall/deadlock saga | §4.4: fence-never-redispatch, revision-raced renewals |
| G5 | Wait-graph cycles; parent-held locks | §4.5: deterministic lock order, slot release, concrete waits |
| G6 | Transitive injection via full replication; shared scratch leaks | §4.6: minimal shards, validated handoffs, explicit state keys |
| G7 | First-report-wins temptation; averaged confidence | §4.7: declared joins, reverified combinations |
| G8 | Combined-patch approval inheritance | §4.8: approval at exact combined artifact |
| G9 | Temporal parent-close lesson; detached cleanup | §4.3: per-child close policy, cooperative cancel scopes |
| G10 | Channel fracture / CFV across workers | Harness matrix §4.2–4.4: isolated memory, confirmed delivery |

### 5.3 Sources

- Context7: `/temporalio/documentation` (child workflows, parent-close policies
  abandon/request-cancel/terminate, cooperative cancellation scopes, detached cleanup);
  `/apache/airflow` (trigger rules on direct parents, retries/eligibility, dynamic mapping,
  zombie/undead detection, scheduler-stall operations); `/websites/langchain_oss_python_langgraph`
  (shared vs private subgraph state, checkpointer propagation, `Command.PARENT` routing,
  checkpoint namespaces).
- Live channels (`agent-reach doctor` 4/16 verified earlier: V2EX, RSS, Jina Reader,
  Bilibili-search; GitHub/YouTube/Exa + 9 login channels unavailable).
- Web: Airflow #7935/#13747/#22350/#28206/#32289 + zombie docs + production-deployment
  scheduler notes; Codex #38408/#19197 orphaned subagents; Claude Code #68110/#69332
  recursive fan-out; Automater fan-out metering ($1.20→$600 table, cap-first rule);
  cycles-docs incident survey; Larridin 47-orphan scans; Kognita $47k kill-switch
  analysis; Forbes supervision-gap piece; DACS scoping; channel-fracture study; CFV
  Distributed Sentinel; subagent-spawn inheritance exploits; subagent isolation practice;
  OpenClaw #58206; OWASP multi-agent coordination appendix.
- Repo: `P0-11 — Task graph and isolated subagent execution contract.md:1-549`
  (invariants, objects, validation, lifecycles, definition/execution split, edges/joins,
  delegation contract, isolation, admission, leases, budgets, worker integration, reports,
  verification-aware joins, failure/replanning, deadlock detection, pause/cancel/orphans,
  recovery, example graph, events/IPC, modules, test matrix, gates, stop conditions).

### 5.4 Open decisions (human-gated, unchanged)

Same six: Apache-2.0 license (no placeholder); Node 24 LTS; `ts-rs` for P0 IPC DTOs; manual
Vite + `pnpm tauri init`; domain-command boundary; dependency-set approval before any install.
Plus P0-11's own gates G1–G5 and the rule that P0-12 memory must not become accidentally
shared mutable state across graph nodes before its contract is accepted.

This matrix authorizes nothing: no child spawning, tools, remote services, dependencies, or
new authority.
