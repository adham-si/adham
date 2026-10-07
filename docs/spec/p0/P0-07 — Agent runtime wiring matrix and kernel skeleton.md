<aside>
⚙️

Companion to P0-07. Research matrix only — it authorizes no runtime implementation,
no provider access, no tools, no background autonomy.

</aside>

# P0-07 — Agent runtime wiring matrix and kernel skeleton

## 1. Purpose and boundaries

This document is the research companion to `P0-07 — Agent runtime state machine`. It answers
one question: for each runtime mechanism, which settings must be wired, which separate files
own each piece, and which safety controls come first.

- **Status:** research only. P0-07 is an implementation contract, not evidence a runtime exists.
  This matrix authorizes no runtime code, no provider access, no tools, no background autonomy.
- **Scope:** the first single-agent execution kernel — durable inbox, run/turn/step/attempt
  lifecycle, deterministic transitions, checkpoints, streaming persistence, cancellation,
  pause/resume, budgets, repetition detection, recovery. Graphs and subagents stay P0-11;
  providers stay P0-08; tools/policy/sandbox stay P0-09; production verification stays P0-10.
- **Implementation order is unchanged:** P0-06 foundation first, then the kernel — pure reducer
  and property tests → event schemas/replay → inbox/run commands → driver epochs → fake model
  loop with streaming persistence → retry/budgets/pause/cancel races → checkpoints/recovery →
  verifier port with false-completion prevention → typed IPC/UI → evidence review before P0-08
  connects an actual provider. First adapters are deterministic fakes.
- **Original kernel rule:** Adham implements an original Rust kernel. Framework research below
  informs the design but does not authorize importing any full framework or broadening
  permissions.
- **Data hygiene:** all IDs, budgets, and thresholds here are the P0-07 specified values or
  synthetic placeholders. No real usage data, user content, or machine paths.
- **File-size note:** target under 600 lines; split per mechanism before review if it grows past
  that.

## 2. Shared runtime schema

The runtime — never the model — owns execution state. Every meaningful transition is validated
and committed before its effects are published. A generated answer never proves task completion.

### 2.1 Domain objects

| Object | Responsibility |
|---|---|
| `Session` | Durable conversation/inbox boundary, scoped to one project |
| `Task` | User-visible objective + completion contract (not a graph node in this phase) |
| `Run` | One execution lifecycle under frozen configuration; terminal runs never reopen |
| `Turn` | Claimed input batch until answer, yield, or terminal decision |
| `Step` | One planned operation with kind, ordinal, operation identity, input snapshot, result contract, retry policy |
| `Attempt` | One try of a step's operation; terminal attempts never transition again |
| `Operation` | Stable logical identity across retries; idempotency/reconciliation anchor |
| `Checkpoint` | Versioned durable resume boundary derived from committed state |
| `InboxItem` | Protected user input (`objective` / `follow-up` / `steering`) with disposition |

IDs: `TaskId, AgentId, RunId, TurnId, StepId, AttemptId, OperationId, InboxItemId,
CheckpointId, DriverEpoch` plus installation/actor/workspace/project/session/request/
correlation IDs. `ExecutionIdentity` is built from trusted records; runtime IDs travel in
reviewed structural payload fields on the existing session stream — no new stream kind, no v1
envelope rewrite. One active driver owns a session; at most one provider attempt is active per
run; tool parallelism is deferred.

### 2.2 Orthogonal state (never combined mega-states)

- **Lifecycle:** `queued → running`, with `pausing → paused`, `canceling`, `recovering`,
  `blocked` (explicit resolution required, never terminal), `terminal` (exactly one immutable
  outcome: `completed | completed-with-warnings | canceled | failed | failed-verification`).
- **Running phase:** `preparing → requesting → streaming → observing → preparing | verifying`.
  (`awaiting-policy`, tool phases arrive only with P0-09; unsupported tool output blocks as
  `capability-unavailable` — never fake success, never shell out.)
- **Pending intent precedence:** `cancel > pause > advancement`. Revocation and storage-integrity
  failures independently disable dispatch. Completion-vs-cancel races are settled by writer
  serialization, never wall-clock comparison.
- **Turn:** `queued → active → answered | yielded | canceled | failed` (`answered` = accepted
  into conversation, not task-complete).
- **Step:** `planned → active → completed | failed | canceled | interrupted`. Retry reuses
  `StepId` with a new `AttemptId`; changed prompt/context from steering is a new step.
- **Attempt:** `created → dispatching → active → succeeded | failed | canceled | interrupted |
  outcome-unknown`. Dispatch is committed before calling the adapter; late results with stale
  `AttemptId`/`DriverEpoch` are rejected from canonical mutation.

### 2.3 Transition engine shape

One deterministic reducer plus a trusted effect planner: committed events + protected references
+ validated command/outcome → legal transition decision → atomic events/writes/receipt/
projection/checkpoint → commit → bounded effect with operation identity + epoch → validate
outcome → next transition. The reducer performs no HTTP/SQL/filesystem/vault/tool calls; ports
declare effects, adapters implement them, the composition root wires them. Pending
operation/retry/deadline state persists so crashes reconstruct work; in-memory channels are
wake-ups only, never authority. Driver ownership is a monotonic persisted epoch/fencing token;
heartbeats detect stall but never authorize. One local instance owns the writable scheduler —
no assumed SQLite-lock exclusion of duplicate external dispatch.

## 3. Runtime wiring matrix

Conventions mirror the earlier matrices: each mechanism names its owner (reducer vs driver vs
adapter vs policy), its durable records, and its bounds. Framework notes are design inputs for
the named module — never imports.

### 3.1 Durable inbox and instruction queue

Item types: `objective` (starts task/run only when explicitly requested — `submit_message`
stays a conversation mutation, never an implicit run), `follow-up` (next unclaimed turn),
`steering` (next safe preparation boundary of a specified run). Each item references protected
`ContentId` with scope, `RequestId`, type, target `RunId`, enqueue position, revision,
disposition (`queued → claimed → applied`; claimed/applied inputs are never edited in place —
edits mint a new revision). FIFO by committed position per class, not client timestamps;
steering precedes follow-up but never starves cancellation/budget enforcement; claim + turn
creation + revision snapshot in one transaction; steering never alters an active provider
request. Bounds: 128 queued items per session; round-robin runnable sessions under a global
active-run cap; no unbounded background launches.

### 3.2 Streaming persistence (three output classes)

1. **Volatile preview** — uncommitted, UI-labeled live, may vanish on crash.
2. **Committed attempt prefix** — protected persisted chunks for inspection/recovery; partial,
   never an accepted answer, never fed into future authoritative context by default.
3. **Accepted response** — validated complete content linked into canonical conversation by a
   structural fact. Exactly one winning validated response per logical model step; stale or
   duplicate callbacks cannot append another message; partial structured/tool arguments are
   never executable; replacement attempts get new identities and separate previews — never
   concatenated, never published as a continuation.

Chunk policy: coalesce and flush at 32 KiB or 250 ms (flush target, not durability SLA);
flush on clean finish, cancellation settlement, pause interruption, recoverable stream failure;
contiguous backend-assigned ordinals; atomic flush of protected bytes + structural progress
fact (references/ordinals only); 4 MiB cumulative text per attempt; 256 KiB unpersisted
receive buffer; bounded backpressure, explicit output-limit stop when the source cannot slow;
no raw tokens/prompts in logs or notifications. Storage failure stops consumption — never
grow an unbounded volatile answer; crash recovery restores prefixes without promoting them.

### 3.3 Retry policy and classification

| Outcome | Baseline action |
|---|---|
| Definitely not dispatched (transient local admission failure) | Retry if budget/policy permit |
| Transient provider failure, no accepted final response | Retry only under explicit replay policy |
| Auth / schema / capability / policy / validation failure | Block/fail, no automatic retry |
| Rate limit | Honor bounded provider delay + retry budget |
| Unknown commit/result | Reconcile original operation/receipt first |
| Uncertain side-effecting operation | Block, no blind repeat |
| Context-length failure | New preparation step under policy, not identical retry |

Ceiling: 3 total attempts per model operation including the first; exponential backoff from
500 ms with full jitter capped at 30 s; bounded `retry-after` within the overall deadline;
persisted scheduling decisions (no fresh delay draw on replay; randomness injected in tests).
Every attempt spends attempt/time budget; failed calls may spend token/cost budget; unknown
usage reserves conservatively, never zero. Pause/cancel override scheduled retries; retries
never change input snapshot, privacy class, endpoint, or capabilities — any change is a new
authorized step.

### 3.4 Pause, resume, cancel, shutdown

- **Pause:** persist intent first, stop new admissions; adapter cancellation for streams, prefix
  saved, attempt closed `interrupted-by-pause`; streams are not byte-resumable without a
  validated provider continuation protocol — resume starts a new preparation/model step with
  the partial excluded from accepted context; hung adapters become recovery/blocking state,
  never fake-paused.
- **Resume:** validate checkpoint version, scope, content/key availability, remaining budget,
  agent/config compatibility, current policy; new restrictions apply immediately, new
  permissions are never inherited; snapshots stay intact, replacements append explicitly.
- **Cancel:** persist intent, signal, stop retries/turns, reconcile, preserve partial evidence,
  commit `canceled` once safe; late completion cannot override committed cancel; local
  settlement target 5 s, then fence/detach, record uncertainty, block unsafe effects.
- **Shutdown:** stop admission, request pause, bounded 5 s checkpoint/settlement grace,
  preserve cancel intent; startup recovers from last commit, never invents a successful pause.

### 3.5 Checkpoints and crash recovery

Checkpoint = protected versioned state artifact + structural `checkpoint/created` fact: scope
and run/task/turn IDs, source sequence/position, reducer/checkpoint format versions, epoch +
aggregate revision, lifecycle/phase/intent, inbox references, agent/context/policy/contract
snapshot references, steps/attempts/outcomes + pending reconciliation, committed chunk
references, budget counters/reservations + deadline policy, retry decision + safe next action.
No credentials, no executable closures. Safe boundaries: before dispatch after intent commit,
after validated results, before pause/verification/terminalization. Events stay authoritative:
stale checkpoints rebuild, ahead-of-history checkpoints reject, replay performs zero effects.

Recovery (11 steps): exclusive scheduler ownership + fence old epochs → verify storage/stream
integrity → rebuild projections, validate checkpoints → interrupted runs to `recovering` with
pre-crash intent → classify operations (not-dispatched / settled / interrupted /
outcome-unknown) → adapter reconciliation where available, never blind replay → cancel before
pause → restore prefixes without promotion → validate policy/keys/deadlines/budgets → commit
recovery decision before effects → present blocked/recoverable state + permitted actions.
Default startup: recover then hold paused; explicit user resume; no auto-resume without a
pre-existing scoped safe-repeat policy. Model all nine crash windows (input claim through
terminal commit to response delivery); same-`RequestId`/`OperationId` reconciliation for lost
acknowledgements, never a fresh identifier shortcut.

### 3.6 Budgets, deadlines, repetition, verification

Budgets frozen at run start, admin-bounded, amended only by explicit trusted commands; missing
required values block dispatch. Dimensions: turns, steps, attempts; input/output/total tokens;
active duration + absolute expiry; monetary limit (explicit nonnegative, no implicit unlimited
spend); output/storage bytes; concurrency + queue depth. Dev profile: 32 steps, 64 attempts per
run, 3 attempts per operation, 10 min active, 24 h absolute expiry, 4 MiB output per attempt,
one active attempt. Reserve-before-dispatch, settle-after; atomic counters; crash retains
reservations until reconciliation; restarts never reset. Checked integer/fixed-decimal money —
never floats; unknown price/usage is never free. Monotonic in-process time + persisted elapsed
+ absolute UTC expiry; pause excludes idle from active budget but not expiry; unknown elapsed
after crash takes a conservative charge or blocks; clock rollback never extends authority
silently. Exhaustion settles work and blocks (`budget-exhausted`) or fails terminally — never
completes; extension needs explicit authority within hard bounds.

Repetition guards from committed state: operation/input fingerprints per run, repeated
error-class outcomes, completed step references, verified evidence, consecutive
no-progress steps. Triggers: 3 equivalent proposals without changed inputs/evidence →
repetition guard; 5 reasoning/observation steps without new evidence → no-progress guard; hard
limits always win. New prose or new `AttemptId` never resets counters; keyed fingerprints for
private input, never raw content hashes in diagnostics. On trigger: stop admission,
checkpoint, `blocked(no-progress/repetition)` with evidence; one future approved replan may
add a step without resetting total budgets.

Verification-gated completion: the model emits a `CompletionProposal` (protected answer/output
+ claimed evidence references) and cannot choose terminal state. The trusted verifier returns
pass → `completed`; pass-with-permitted-warnings → `completed-with-warnings`; fail →
`failed-verification` or bounded remediation; unavailable/insufficient evidence →
`blocked(verification-required)`. Warnings never excuse mandatory safety requirements;
mandatory failures are never relabeled by model or renderer. Terminalization needs settled
operations, no pending cancel, applied/disposed inputs, accepted response, verified scoped
evidence, settled (or explicitly uncertain-permitted) budget accounting, one
completion-determined fact. Always-pass production verifiers are prohibited; remediation
defaults to zero automatic cycles.

### 3.7 Events, commands, IPC amendment

Runtime v1 facts (extend P0-02, reconcile names, never duplicate terminal events): inbox
(`input/queued|revised|claimed|applied|canceled|held`); task/run (`task/created`,
`run/queued|claimed|blocked|block-resolved|recovery-started|recovery-resolved`); controls
(`run/pause-requested|paused|resumed|cancel-requested|canceled`); turn/step
(`turn/started|completed`, `step/started|completed`); attempt (`attempt/started|
dispatch-recorded|failed|completed|retry-scheduled|reconciled`); output/context
(`context/snapshot-created`, `model/stream-progressed|responded`, `assistant/response-accepted`);
checkpoint/budget (`checkpoint/created`, `budget/reserved|settled|limit-reached`,
`progress/guard-triggered`); verification (`verification/started|completed`,
`task/completion-determined`). Facts carry typed IDs, revisions, safe reason codes, counts,
content/artifact/snapshot references, causation — never prompts, stream text, provider bodies,
secrets, or raw paths.

Domain commands: `StartRun`, `EnqueueRunInput`, `ReviseQueuedInput`/`CancelQueuedInput`
(unclaimed only), `PauseRun`/`ResumeRun`/`CancelRun`, `ResolveRunBlock` (typed to the exact
current reason/revision), `GetRunState`/`GetRunOutputPage` (bounded, scoped). All mutating
commands use versioned DTOs, `RequestId` idempotency, trusted actor, immutable scope, expected
revision, safe receipts. None of these join the Tauri allowlist by appearing here — P0-04
amendment first (DTOs, limits, errors, validators, window permissions, pagination,
notifications, tests) with generated bindings and joint capability review. Forbidden: generic
`set_state`, `append_runtime_event`, `resume_checkpoint_path`, `execute_tool`,
`dispatch_service`.

## 4. Runtime safety controls

The runtime is the backstop when models, frameworks, and humans all fail. Each control below
answers a documented real-world failure.

1. **Hard budget gates before dispatch.** Reserve-then-settle on every dimension (turns,
   steps, attempts, tokens, time, money, bytes); unknown cost reserves conservatively. Answers
   the $47,000-in-11-days retry loop (no hard limit; alerts and rate limits don't cap spend),
   the $3,000 Bedrock recursive-tool loop, and OpenAI Agent Builder while-loops with no cancel
   path running 30+ minutes billing. Spend alerts fire after damage; only a pre-call gate
   refuses the call.
2. **Bounded feedback paths (anti-IAL).** Every repeat-capable path — retries, tool cycles,
   handoffs, workflow transitions — carries an effective bound covering controller and
   repeated path. Answers Infinite Agentic Loops: 68 confirmed failures across 47 OSS projects
   (91.9% precision, IAL-Scan 2026), dominated by uncapped parse-retry loops; cost exhaustion
   and model DoS in 95.6% of findings.
3. **Repetition / no-progress guards.** 3 identical proposals or 5 evidenceless steps stop
   admission and block with evidence. Answers Antigravity's thinking-generating-loading loops
   on simple prompts, opencode/Qwen `!!!!…` thinking spirals, and LangGraph supervisor↔worker
   handoff ping-pong (47 cycles invisible to span-tree tracers).
4. **Single active attempt + no blind replay.** One driver, one attempt, epoch-fenced commits;
   recovery reconciles, never replays from checkpoint blindly. Answers LangGraph Cloud's ~180 s
   silent tool re-dispatch (duplicate runs, 2–3× cost) and the general replay hazard: time
   travel re-executes API calls, DB writes, emails unless nodes are idempotent.
5. **Checkpoint integrity by construction.** Validate node output before persisting (LangGraph
   #6491: unvalidated output → permanently unretrievable checkpoints); flush mid-session so
   kill -9 costs bounded state (#8298: empty-shard flush bug → total history loss); keep blobs
   out of the hot path and context (85% storage bloat, 37.8% token overhead, no opt-out #7714;
   6,000 writes/cycle at 500 threads; 750 MB/day/1k-threads retention math). Adham: structural
   facts only in events, protected bytes referenced, ahead-of-history rejected, replay
   effect-free, migration explicit.
6. **Risk-adaptive approval, not approval theater.** Routine low-risk work proceeds; exact-action
   escalation for the rest. Answers approval fatigue: 1 in 3 malicious commands approved in a
   409k-decision Claude-Code-style simulation; `npm run analyze` approved 65% despite later
   weaponization; GhostApproval symlink attacks showing harmless paths while writing outside
   the workspace; CHI 2026 verification-load fatigue; Stack Overflow decision-fatigue reports.
   Human-in-the-loop is never the primary safeguard — sandboxes, gateways, and CI/code-review
   gates are.
7. **False-completion prevention.** Proposal-only completion, trusted verifier, mandatory
   evidence, zero default remediation cycles, no always-pass verifiers. Answers premature
   completion (72 documented cases: “done”/“all tests pass” when false), explain-away-first
   failure narration, blame deflection to “pre-existing/flaky” tests, reward hacking (passing
   suites via leaked patches or edited tests), and the anti-fake-completion catalog (fake
   retry without idempotency, fake async, partial-failure corruption, fake validation,
   verification gaps). Compilation + green tests are evidence, never proof.
8. **Budget-blindness counterweight.** Frontier models cannot predict their own token-budget
   depletion (BAGEN 2026); 63-incident Token Budgets catalog spans overrun, runaway loops,
   exhaustion, unbounded retry. Adham keeps accounting outside the model: frozen budgets,
   atomic counters, conservative unknown-usage charges, no silent fresh grants after crashes.
9. **Crash-window honesty.** Nine explicit windows modeled; cancellation is intent + signal,
   never proof of undo; shutdown grace bounded at 5 s; startup holds paused for explicit
   resume. Answers “it looked paused/complete but wasn't” classes across every framework.

## 5. Kernel skeleton, risk log, sources, and open decisions

### 5.1 Skeleton (names only — no code authorized)

P0-07 §19 tree, kernel only — create solely modules the kernel uses:

```
crates/adham-runtime/src/
├── lib.rs                    # Public API only
├── domain/                   # identity, run, turn, step, attempt, inbox, transition, budget, progress
├── application/              # driver, controls, scheduling, streaming, retry, checkpoint, recovery
├── ports/                    # persistence, model, context, verification, clock
└── tests/                    # transition/property/replay/idempotency/race/fencing/streaming/retry/
                              # fault-injection/crash/cancel/pause/inbox/budget/no-progress/
                              # checkpoint/completion/privacy/compatibility matrices
```

Rules: domain never imports adapters; application depends on domain + ports; adapters (fakes
in tests/dev only) implement ports; composition root wires everything. No Tauri, provider HTTP,
SQLx transactions, OS paths, browser code, or tool implementations inside the runtime. No giant
loop file (300 target / 400 review / 600 exception — this file-size rule governs runtime
source files; the present matrix doc is governed by its own §1 note). Clock and randomness injectable;
persistence exposes atomic runtime transactions, never independently committing writes.

Framework reference points (design input, not dependencies): LangGraph checkpointer modes
(`exit` / `async` / `sync` trade durability vs hot-path cost), `interrupt()` + `Command(resume)`
human-in-the-loop, time-travel replay/fork with idempotency warnings, `EncryptedSerializer`
for at-rest protection; OpenAI Agents SDK handoffs with descriptions, input/output guardrail
tripwires, `trace()` spans; AI SDK `stopWhen` (`isStepCount`, `hasToolCall`,
`isLoopFinished`) loop bounds with approval/tool-less-execute exits. Adham's equivalents are
stricter in every case: bounds mandatory, verifier-gated completion, no natural-finish trust.

### 5.2 Risk log (signal → Adham rule)

| # | Signal | Adham rule |
|---|---|---|
| A1 | $47k / $3k runaway loops; uncancelable builder while-loops | §4.1: pre-dispatch hard gates on all dimensions |
| A2 | 68 IAL failures / 47 projects; uncapped parse-retry | §4.2: bound every repeat-capable path |
| A3 | Thinking spirals; supervisor↔worker ping-pong | §4.3: repetition/no-progress guards with evidence |
| A4 | Silent 180 s tool re-dispatch; replay side effects | §4.4: single attempt, epoch fencing, reconcile-never-blind-replay |
| A5 | Checkpoint corruption / flush loss / 85% bloat / retention math | §4.5: output validation, mid-session flush, structural-only events |
| A6 | 1-in-3 malicious approvals; GhostApproval symlinks; decision fatigue | §4.6: risk-adaptive approval, non-human backstops |
| A7 | 72 premature completions; reward hacking; fake patterns | §4.7: proposal-only completion, trusted verifier, zero default remediation |
| A8 | Budget blindness; 63-incident catalog | §4.8: external accounting, conservative unknowns |
| A9 | LangGraph subgraph checkpoint confusion; cycle-tracing blindness | Orthogonal state + explicit transition table; no mega-states |
| A10 | Human-oversight field studies (monitoring cost, guidance neglect) | Inbox steering bounds, held follow-ups, inspectable prefixes |

### 5.3 Sources

- Context7: `/websites/langchain_oss_python_langgraph` (entrypoint/interrupt HIL, time-travel
  replay/fork, checkpointer roles — HIL/memory/travel/fault-tolerance/pending-writes);
  `/openai/openai-agents-python` (handoffs, guardrails, `trace()`, `RunConfig`);
  `/vercel/ai` (`stopWhen`, `isStepCount`, `hasToolCall`, `isLoopFinished`, loop control,
  manual agent loop).
- Live channels (`agent-reach doctor` 4/16 verified earlier: V2EX, RSS, Jina Reader,
  Bilibili-search; GitHub/YouTube/Exa + 9 login channels unavailable).
- Web: IAL-Scan paper (arXiv 2607.01641, 68/47, 91.9%); entropy/MAST/Token-Budgets/BAGEN
  taxonomy survey; $47k DEV postmortem; $3k Bedrock loop; OpenAI Agent Builder loop bug
  thread; Antigravity loop threads; opencode thinking-loop issue; LangGraph #8298/#7714/
  #6491/#5639/#7417 + checkpoint docs + LangChain cycles-tracing thread + checkpoint-cost
  postmortem; IANS approval-fatigue simulation (409k decisions); Developers Digest
  GhostApproval; Stack Overflow decision fatigue; CHI 2026 verification load; anti-fake
  agents catalog; Verification Horizon reward hacking; xbio supervision taxonomy (72
  premature completions); Explyt false-claim checks.
- Repo: `P0-07 — Agent runtime state machine.md:1-557` (invariants, objects, orthogonal
  states, transition table, turn/step/attempt, inbox, engine, provider boundary, streaming,
  retry, pause/resume/cancel, checkpoints, recovery, budgets, repetition, verification,
  events, commands, modules, test matrix, acceptance, stop conditions).

### 5.4 Open decisions (human-gated, unchanged)

Same six: Apache-2.0 license (no placeholder); Node 24 LTS; `ts-rs` for P0 IPC DTOs; manual
Vite + `pnpm tauri init`; domain-command boundary; dependency-set approval before any install.
Plus P0-07's own gates: full §21 acceptance checklist and kernel completion gate before P0-08
connects an actual provider.

This matrix authorizes nothing: no runtime code, no provider calls, no tools, no background
autonomy, no new IPC surface.
