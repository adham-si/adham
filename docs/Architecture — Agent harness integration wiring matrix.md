<aside>
🎛️

Cross-P0 integration companion. Research matrix only — it authorizes no runtime code,
no provider access, no tools, no memory writes, no background autonomy.

</aside>

# Architecture — Agent harness integration wiring matrix

## 1. Purpose and boundaries

This document is the integration companion to the P0 matrix family (P0-07 runtime, P0-08
providers, P0-10 verification, P0-13 MCP, P0-14 plugins) and to the pinned
`Architecture research — DeepSeek Harness & YoAgent P0 audit`. It answers one question: how
the harness — the control layer between models and real-world actions — wires its member
domains together, which crate owns each piece, and which integration controls come first.

- **Status:** research only. It authorizes no runtime code, provider access, tools, memory
  writes, installs, or background autonomy. Each member P0 keeps its own gates; this matrix
  adds no new gate, it only records how the gates compose.
- **Scope:** the single-agent harness core — runtime, provider gateway + router, tools +
  policy + sandbox, context assembly, memory, agents definitions, verification, artifacts,
  extensions, secrets, and the typed desktop IPC. Task graphs and subagents stay P0-11
  (adjacent: this matrix states the harness-side delegation boundary, not graph internals).
- **Reference decision (audit, unchanged):** YoAgent-shaped Rust kernel with DeepSeek durable
  semantics — append-only event log as source of truth, rebuilt requests, synchronous
  projections, explicit turn/step/attempt/tool/retry/cancellation events, resumable sessions,
  ordered bounded-parallel tools, non-destructive compaction, exact-action escalation. Adopt
  patterns, never copy products wholesale; combine behind Adham's stricter isolation, privacy
  routing, policy, audit, and verification contracts.
- **Implementation order is unchanged (audit §6):** identifiers + event schemas → SQLite/WAL
  store → projections → single-agent loop → provider gateway (Ollama Local + one cloud) →
  tool scheduler + policy engine → native sandbox + approval flow → context budgeting +
  artifact-backed results → verification contracts → child-session subagents only after
  single-agent recovery and isolation tests pass.
- **Data hygiene:** all identities, budgets, and thresholds are specified values or synthetic
  placeholders. No real usage data, user content, or machine paths.
- **File-size note:** target under 600 lines; split per flow before review if it grows past
  that. (Placed at `docs/` beside the audit doc because it integrates across P0s instead of
  companioning one.)

## 2. Harness ownership map

Every run carries an immutable identity tuple — installation, workspace(s), project, session,
agent, run, turn, step, attempt — built from trusted records, never inferred from visible UI.
Provider clients, tool registries, memory, filesystem roots, budgets, and policy snapshots all
derive from it. The event log (stable schemas, monotonic sequences, migrations, checksums,
atomic persistence) is the source of truth; UI and runtime views are rebuildable projections
(conversation, inbox, plan/graph, running agents, tool history, file changes, cost/tokens,
context pressure, approvals, verification status).

| Crate | Owns | Never touches |
|---|---|---|
| `adham-core-types` | IDs, events, errors, capability descriptors | Everything else |
| `adham-event-log` | Append, transactions, checksums, replay, migrations | Domain semantics |
| `adham-projections` | Conversation, tasks, usage, approvals, artifacts views | Authoritative state |
| `adham-runtime` | Turn/step/attempt machine, queue, cancel, retry, checkpoints | Provider HTTP, tools, SQL, paths |
| `adham-provider` | Ports + normalized streaming events | Routing, budgets, completion |
| `adham-router` | Selection, fallback chains, capability match, privacy classes | Concrete provider clients |
| `adham-tools` | Normalized definitions, calls, scheduling, idempotency, timeouts | Self-authorization |
| `adham-policy` | Inherited rules, frozen context, approvals, grants, denials, audit | Tool internals |
| `adham-context` | Authorized assembly, token budgets, compaction refs, redaction | Project storage, memory stores |
| `adham-memory` | Proposals, authority, provenance, retrieval, retention, deletion | Silent side-effect writes |
| `adham-agents` | Definitions, versions, assignments, delegation contracts, budgets | Child execution |
| `adham-verify` | Completion contracts + evidence verdicts | Terminal lifecycle (runtime's) |
| `adham-artifacts` | Immutable large outputs, hashes, retention, references | Interpretation of content |
| `adham-extensions` | Skills, MCP, plugins, manifests, trust, grants, lifecycle | Untrusted code in core |
| `adham-secrets` | OS vault broker, short-lived scoped issuance | Policy decisions |
| `adham-desktop-api` | Narrow typed IPC (thin Tauri shell above it) | Business logic |

Dependency direction is inward: domain code imports no Tauri, SQLx, HTTP, filesystem, or
frontend concepts; adapters implement ports and are wired in the composition root only.
Cross-context writes travel through application services or domain commands — never direct
database access. The frontend reaches all of this through typed commands and event
subscriptions; it never mutates runtime state directly and never holds credentials.

## 3. Integration wiring matrix

Each flow names its stage owners and handoff records. Model output is data at every
boundary — it requests, proposes, and drafts; trusted services validate, decide, and commit.

### 3.1 Model step pipeline (per attempt)

Runtime step → immutable request/context snapshot (`context`) → capability + model-revision
validation (`provider`) → project/account/endpoint grant (`policy` + `secrets` broker) →
privacy + retention + destination check (`router` + `policy`) → token/output estimate and
budget reservation (`runtime`) → adapter encodes one request (`provider` adapter) → bounded
transport/parser → normalized stream/result → runtime validates and commits protected
output/usage → projection/verification path. Retry, fallback, and cancellation intent stay in
the runtime; adapters perform no hidden retry or ambient fallback (local-to-cloud movement is
a new authorized selection with an explicit privacy decision, never a retry).

### 3.2 Context assembly (authorized, budgeted, non-destructive)

The context service builds exactly what the model may see for one attempt: claimed inbox
inputs, conversation slice, retrieved tool/skill candidates, memory excerpts under grant,
and compaction references — within frozen token/output budgets, with model-visible
redaction. Rules: adapters receive only resolved authorized content (no reaching into
project storage or memory); large tool outputs persist as artifacts with a bounded excerpt
plus retrievable reference; compaction never rewrites canonical history — it emits summary
or replacement projections tied to exact source ranges, model, prompt version, and token
accounting. Framework levers, Adham-stricter: keep the toolset lean (tool search over
eager schemas past ~20 tools; prompt caching for stable definitions; context editing to trim
dead `tool_result` blocks; programmatic batching for repetitive chains); retrieve-then-read
instead of dumping stores; session history bounded per run (`SessionSettings`-class limit,
not unbounded preload); vector/memory retrieval as composable, truncating, token-counted
blocks — relevance never upgrades authority.

### 3.3 Tool scheduling and policy chain

Every tool declares: read-only vs side-effecting; parallel-safe vs exclusive; idempotency +
retry behavior; required capabilities; filesystem/network scope; cost/timeout class;
result-size policy; compensation/rollback support. Parallel-safe calls run within a
configured bound; exclusive/order-dependent calls preserve model order; retries never repeat
uncertain side effects without an idempotency key or verified recovery path. Chain:
`request → normalized action → policy evaluation → approval if needed → sandbox grant →
execution → audit event`, with escalation scoped to the exact normalized action, narrowest
capability, defined duration — denial keeps the task alive where a permitted alternative
exists. Capability discovery stays lazy and budgeted (searchable registry, small candidate
shortlist per task, full schemas loaded just-in-time, one primary skill per phase).

### 3.4 Memory pipeline (governed, never ambient)

Separate conversation (session messages), working context (per-attempt ephemera),
checkpoints (recovery refs), memory (deliberately retained knowledge), artifacts/evidence
(task-scoped, never auto-generalized), and indexes (disposable derivatives, never
authority). Write path: `potential fact → protected proposal → scope/category/provenance
validation → sensitivity/policy/duplication/conflict checks → exact review or bounded
standing rule → atomic revision commit → index hint`. Retrieval needs its own grant per
scope (personal / workspace / team / project / agent / session-task); relevance, confidence,
frequency, or consensus never promote authority; remembered text never overrides policy or
satisfies verification for a changed candidate. Scopes are immutable per record; promotion
is a new governed record with lineage. Revocation/forgetting suppresses retrieval
immediately via generation checks, even before index cleanup; replay rebuilds structure but
never resurrects erased payloads. Subagents get explicit snapshots/grants — never ambient
manager inheritance.

### 3.5 Delegation boundary (harness side; internals stay P0-11)

A subagent is a child session: focused objective, bounded context shard, own event stream,
budget, tool grants, cancellation token, no implicit parent mutable state, structured
progress/final-report contracts, explicit artifact/evidence handoff. Manager and model submit
proposals; the trusted graph service validates transitions; child reports are untrusted until
validated; several successful children never auto-complete the parent (verification-aware
joins under P0-10). Shared mutable state is replaced by capability handles or audited
message passing; budgets subdivide down a single hierarchy that delegation can never
multiply; leases fence ownership without proving side effects stopped; replay never spawns
children or repeats patches. Supervisor-as-tool registry pattern is allowed only with
isolated per-child contexts and capability intersection (never exceeding the parent's
delegable authority under current policy).

### 3.6 Verification and event closure

Verifier checks run in validated staging with read-only sources, separate scratch, no
ambient secrets/network; trusted outer capture observes status and manifests independently
of project-controlled output. Terminalization joins runtime closure with completion
determination atomically; exactly one terminal determination per run; post-commit drift
marks applicability stale without rewriting history. Projections carry criterion coverage,
check results, applicability, findings, history, and handoff state — never the only copy of
anything.

## 4. Harness safety controls

The harness is the backstop for failures no single domain can see: what the agent forgets,
what leaks across contexts, and what the framework hides.

1. **Govern forgetting explicitly.** Compaction is governance-critical, not just an accuracy
   tradeoff: summarization silently drops soft deployment-specific constraints (Governance
   Decay benchmark across 7 model families × 4 strategies), discards build/environment
   context mid-task, destroys causal tool→decision→action provenance, costs a full-window
   LLM call at the worst moment, and can be triggered on demand through poisoned tool
   outputs. Adham rules: non-destructive projections with source ranges (§3.2), governance
   facts in policy-held state rather than context-only, artifact-backed outputs over
   re-ingestion, compact at clean task boundaries — never mid-refactor.
2. **Isolate contexts by construction.** Flat shared context contaminates steering
   (wrong-agent contamination 28–57% flat vs 0–14% scoped; steering accuracy 21–60% vs
   90–98.4% — DACS study, 200 trials). Full context replication at spawn propagates any
   parent injection to every descendant transitively. Adham rules: per-agent working memory
   isolated, shared state as a separate authoritative layer with explicit promotion, child
   shards immutable and minimal, no cache/registry/event/artifact mixing across
   parent/child/sibling (P0-11 invariants), cache keys namespaced per session (Claude Code
   #26330 cross-session cache leakage class), workspace binding resolved per spawned agent
   (OpenClaw #58206 parent-context-inheritance class).
3. **Verify cross-context delivery.** Scheduled/background agents silently fail to write
   target memory through valid-looking channels (channel fracture, 67–98% failure without
   delivery verification vs 0% with). Adham rule: writer-side success never implies delivery —
   confirm in the target context (read-back or explicit acknowledgement) before proceeding.
4. **Enforce above the agents.** Locally legitimate actions compose into policy violations
   when facts fragment across private contexts (CFV rates 14–98% across 8 frontier models;
   cross-domain flows systematically worse). Self-avoidance is unreliable. Adham rule: the
   centralized policy layer from §3.3 judges cross-domain sequences, never each agent alone.
5. **Keep the harness thin and observable.** Framework bloat postmortem is consistent:
   chains/runnables/agents/tools/callbacks over 10-line API calls, dependency graphs like
   spaghetti JSON, black-box debugging rabbit holes, frozen tutorials, production rewrites
   from scratch (HN/Reddit/DEV consensus; LangChain forum: use frameworks only past
   single-prompt complexity). Adham rules: ports over frameworks, reducer with no IO,
   effects behind injectable adapters, deterministic replay as the debugger, dependency
   added only when consumed and reviewed.
6. **Curate the toolset.** Bloated overlapping toolsets are a top agent failure mode — if a
   human cannot say which tool fits, the agent cannot either (Anthropic context engineering).
   Adham rules: minimal viable toolset per task, self-contained robust tools with
   unambiguous inputs, canonical examples over rule laundry lists, tool search +
   just-in-time schemas, one primary skill per phase.
7. **Bound the session.** SQLite-style auto-memory helps until it silently preloads entire
   histories; vector memory retrieves without authority. Adham rules: explicit per-run
   history limits, grant-checked memory blocks with truncation accounting, session/task
   observations expiry-scoped and never auto-promoted.

## 5. Crate skeleton, risk log, sources, and open decisions

### 5.1 Skeleton (names only — no code authorized)

Audit §5 crate map, composition root wiring only:

```
crates/
├── adham-core-types/    # IDs, events, errors, capability descriptors (near-zero deps)
├── adham-event-log/     # append/replay/checksums + SQLite/WAL + migrations
├── adham-projections/   # rebuildable conversation/task/usage/approval/artifact views
├── adham-runtime/       # turn/step/attempt machine (P0-07 matrix doc)
├── adham-provider/      # ports + normalization (P0-08 matrix doc)
├── adham-router/        # selection, fallback, privacy classes
├── adham-tools/         # registry + scheduler            } P0-09 contract next
├── adham-policy/        # rules, approvals, grants, snapshots } (no matrix yet)
├── adham-context/       # assembly, retrieval, budgeting, compaction
├── adham-memory/        # proposals, provenance, grants (P0-12 governs)
├── adham-agents/        # definitions, delegation contracts (P0-11 governs children)
├── adham-verify/        # contracts + verdicts (P0-10 matrix doc)
├── adham-artifacts/     # immutable outputs, patches
├── adham-extensions/    # skills/MCP/plugins (P0-13/14 matrix docs)
├── adham-secrets/       # OS vault broker
└── adham-desktop-api/   # narrow typed IPC (thin Tauri shell above it)
```

Rules: domain imports nothing infrastructural; `application` uses domain + ports; `adapters`
implement ports (SQLx, reqwest+rustls, keyring, OS APIs) and are constructed in the
composition root; lib.rs-only consumption across crates; file targets 300/400/600 apply
to future crate sources, not to this matrix doc (governed by its own §1 note). Frontend
reaches the harness through typed commands/events only.

### 5.2 Risk log (signal → Adham rule)

| # | Signal | Adham rule |
|---|---|---|
| H1 | Governance Decay via compaction (7 families × 4 strategies) | §4.1: non-destructive projections, policy-held governance facts |
| H2 | Context pollution 28–57% → 0–14% scoped; transitive spawn contamination | §4.2: isolated working memory, minimal immutable shards |
| H3 | Channel fracture 67–98% silent delivery failure | §4.3: target-context delivery confirmation |
| H4 | CFV 14–98% across frontier models | §4.4: centralized cross-domain enforcement |
| H5 | Cache cross-contamination; workspace inheritance leaks | §4.2: namespaced caches, per-agent workspace binding |
| H6 | Framework bloat/black-box consensus | §4.5: thin ports, IO-free reducer, replay debugger |
| H7 | Bloated toolsets as top failure mode | §4.6: minimal sets, tool search, JIT schemas |
| H8 | Quadratic context cost; Lost-in-the-Middle; 7× pointer-method savings | §3.2: artifact-backed outputs, bounded excerpts + references |
| H9 | 85%-at-threshold compaction mistiming; /compact manual escapes | §4.1: boundary-aware compaction, never mid-complex-work |
| H10 | Unbounded session preload; authority-free vector recall | §4.7: per-run limits, grant-checked truncated blocks |

### 5.3 Sources

- Context7: `/websites/langchain_oss_python_langchain` (LLM tool-selector middleware,
  subagent registry + `task` dispatch tool, supervisor wrapping, router graphs, progressive
  disclosure); `/websites/developers_llamaindex_ai_python` (vector + SQL memory retrieval,
  token-counted truncation, memory blocks, query engines); `/openai/openai-agents-python`
  (SQLiteSession auto-history, `SessionSettings(limit)`, pre/post-run store semantics).
- Live channels (`agent-reach doctor` 4/16 verified earlier: V2EX, RSS, Jina Reader,
  Bilibili-search; GitHub/YouTube/Exa + 9 login channels unavailable).
- Web: Anthropic context engineering (tool bloat, minimal sets, tool search/caching/editing);
  LangChain autonomous compaction (85% threshold, opportune timing); ARC addressable-recall
  compaction; CWL structured eviction (lossiness/structure/cost/hallucination critique);
  Governance Decay paper; Active Context Compression (Focus loop); DACS scoping (90–98.4%
  vs 21–60%); channel-fracture study; CFV Distributed Sentinel (14–98%); subagent-spawn
  inheritance exploits; subagent context-isolation practice; Claude Code #26330; OpenClaw
  #58206; OWASP multi-agent coordination appendix; LangChain bloat critiques (Medium, DEV,
  HN threads, forum); cross-tenant contamination notes.
- Repo: `Architecture research — DeepSeek Harness & YoAgent P0 audit.md:1-280` (decision,
  comparison table, identity, event log, projections, state machine, tool scheduling,
  policy-before-execution, provider routing, non-destructive context, isolated subagents,
  verification gate, adoptions, crate map, P0 order); `docs/adham.md` harness + reliability
  sections; P0-07/08/09/10/11/12/13 contracts as cited.

### 5.4 Open decisions (human-gated, unchanged)

Same six: Apache-2.0 license (no placeholder); Node 24 LTS; `ts-rs` for P0 IPC DTOs; manual
Vite + `pnpm tauri init`; domain-command boundary; dependency-set approval before any install.
Plus: member-P0 acceptance checklists stay authoritative — this matrix resolves no conflict
between P0s; any contradiction found during implementation returns to the owning contract for
review rather than inventing a weaker composition.

This matrix authorizes nothing: no runtime code, provider calls, tools, memory writes,
installs, background autonomy, or new IPC surface.
