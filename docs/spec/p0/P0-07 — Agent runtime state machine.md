<aside>
⚙️

The runtime—not the model—owns execution state. Every meaningful transition is validated and committed before its effects are published. Cancellation, interruption, retries, and completion have explicit durable outcomes; a generated answer is not proof that a task is complete.

</aside>

## Purpose and implementation boundary

Define Adham’s first single-agent execution kernel: durable inbox, run/turn/step/attempt lifecycle, deterministic transitions, checkpoints, streaming persistence, cancellation, pause/resume, budgets, repetition detection, and recovery.

This is an implementation contract, not evidence that a runtime exists. Runtime implementation begins only after the persistent P0-06 foundation passes. P0-07 may be implemented first with deterministic fake provider and verifier adapters. Actual provider access belongs to P0-08; tools/policy/sandbox to P0-09; production completion verification to P0-10; graphs and subagents to P0-11.

### Governing documents

- P0-06 — Repository scaffold execution and evidence checklist.
- P0-02 — Canonical event taxonomy & schema.
- P0-03 — SQLite event store, content & projections.
- P0-04 — Typed IPC, capabilities & frontend sync.
- P0-05 — Project-isolation threat model.
- Architecture research — DeepSeek Harness & YoAgent P0 audit.

Adham implements an original Rust kernel. Research informs the design but does not authorize importing either full framework or broadening permissions.

## 1. Core invariants

1. Canonical events and protected content are authoritative; runtime objects and projections are rebuildable.
2. A run has immutable workspace/project/session/agent identity. Switching the visible project never retargets work.
3. Only trusted application services append runtime events or determine legal transitions.
4. One active driver owns a session at a time in this first kernel. Concurrent sessions/projects are allowed only within global resource limits.
5. At most one provider attempt is active per run in P0-07. Tool parallelism is deferred.
6. Every logical external operation has a stable OperationId; every execution try has a distinct AttemptId.
7. Terminal states are immutable. Resume/retry after termination creates a new run with provenance.
8. Cancellation is a durable request plus a cooperative signal—not evidence that an external action was undone.
9. No incomplete response, partial tool call, or malformed model output can authorize execution.
10. No retry duplicates accepted conversation output or blindly repeats an uncertain side effect.
11. Completion requires a trusted verification outcome. The model may only propose completion.
12. Private instructions, context, deltas, outputs, and error bodies never appear directly in structural events or default diagnostics.
13. Unknown event versions, lost authority, or canonical corruption stop affected execution safely.
14. Failure to persist means stop dispatch; never continue from an uncommitted in-memory state.

## 2. Domain objects and identities

| Object | Responsibility |
| --- | --- |
| Session | Durable conversation/inbox boundary, scoped to one project |
| Task | User-visible objective and completion contract; not a graph node in this phase |
| Run | One execution lifecycle attempting that objective under frozen configuration |
| Turn | A claimed batch of input plus subsequent reasoning/execution until an answer, yield, or terminal decision |
| Step | One planned operation: context preparation, model call, observation, or verification |
| Attempt | One try of a step’s external/deterministic operation |
| Operation | Stable logical operation identity across retries; provider/tool idempotency and reconciliation anchor |
| Checkpoint | Versioned durable resume boundary derived from committed state |
| Inbox item | Protected user input reference with disposition and application boundary |

Task and Run are separate: a task may have later explicitly requested runs, but a terminal run is never reopened. This phase has no graph scheduling or automatic task fan-out.

Backend-generated typed IDs include TaskId, AgentId, RunId, TurnId, StepId, AttemptId, OperationId, InboxItemId, CheckpointId, and DriverEpoch. They supplement the existing installation, actor, workspace, project, session, request, and correlation IDs.

ExecutionIdentity is constructed from trusted records. Domain events use the existing session stream with runtime IDs in reviewed structural payload fields. Do not add a new stream kind or rewrite the v1 event envelope merely to implement a run.

AgentId initially identifies a reviewed local agent definition/version snapshot—not an implemented visual builder or delegation capability. Provider, policy, context, budget, and completion-contract snapshots are scoped to the run and cannot change through mutable global settings.

## 3. Orthogonal run state model

Separate **lifecycle**, **phase**, and **pending control intent**. Avoid dozens of combined states such as paused-streaming-retrying.

### Lifecycle

| State | Meaning |
| --- | --- |
| queued | Accepted run, not yet claimed by driver |
| running | Driver may advance legal steps |
| pausing | Pause accepted; stopping admission and reaching a safe boundary |
| paused | No active external operation; durable checkpoint exists |
| canceling | Cancel accepted; stopping work and reconciling in-flight operations |
| recovering | Previous driver interrupted; inspect persisted operation outcomes before dispatch |
| blocked | No runnable work until an explicit resolution; no active operation |
| terminal | Exactly one immutable terminal outcome exists |

### Running phase

preparing → requesting → streaming → observing → preparing or verifying

Later integration may insert awaiting-policy, executing-tools, and observing-tool-results, but these phases cannot execute until P0-09 is accepted. A complete response with unsupported tool requests becomes blocked(capability-unavailable); never fake success or run shell commands directly.

### Terminal outcome

- completed
- completed-with-warnings
- canceled
- failed
- failed-verification

Store the outcome and bounded reason code separately from lifecycle. blocked is not terminal and cannot conceal still-running work. Terminalization closes open children as completed/failed/canceled/interrupted as appropriate in the same state transition transaction.

### Pending intent precedence

cancel > pause > ordinary advancement. Security revocation/storage integrity failures independently disable dispatch and may require recovery rather than a clean terminal outcome.

If completion committed before cancellation, cancellation returns already-terminal. If cancellation committed first, the completion proposal cannot terminalize the run as completed. Writer serialization determines the winner, not wall-clock timestamp comparison.

## 4. Legal run transitions

Every transition compares aggregate revision and current DriverEpoch, validates invariants, appends facts, and updates projections atomically.

| From | Trigger | To | Required conditions/effect |
| --- | --- | --- | --- |
| none | StartRun accepted | queued | Scoped objective/input and frozen snapshots stored |
| queued | Driver claims | running/preparing | Session slot and global capacity acquired; fresh epoch |
| queued | CancelRun | terminal/canceled | No operation was dispatched; queued inputs disposed explicitly |
| running | Valid phase advancement | running/next-phase | Child step/attempt outcome committed |
| running | PauseRun | pausing | Persist pause intent; stop new operation admission |
| pausing | Safe boundary | paused | No active operation; checkpoint committed |
| running or pausing | CancelRun | canceling | Persist cancel intent; signal active operation |
| paused, blocked, or queued | CancelRun | terminal/canceled | No active operation or unresolved side-effect uncertainty |
| canceling | Operation settled | terminal/canceled | Accepted prefixes saved; operation outcome known or explicitly represented as uncertain |
| running | Recoverable inability to progress | blocked | No active operation; reason and permitted resolution recorded |
| paused | ResumeRun | running/preparing | Checkpoint/schema/policy/budgets valid; fresh driver epoch |
| blocked | ResolveRunBlock | running/preparing or recovering | Exact resolution validated; no implicit capability expansion |
| any nonterminal active state | Driver interrupted | recovering | Old epoch fenced; recorded phase cannot be assumed complete |
| recovering | Reconciliation succeeds | paused, blocked, running, or terminal | Preserve prior control intent; dispatch only under approved recovery policy |
| running/verifying | Trusted completion verdict | terminal/outcome | Required contract satisfied; no cancel/pause race, unresolved operation, or missing evidence |
| running | Nonrecoverable fault | terminal/failed | Operations safely closed/reconciled; redacted reason |
| terminal | Any resume/advance callback | unchanged | Reject transition; stale callback cannot mutate |

Interrupted/unknown external side effects normally block for reconciliation. A canceled run may record an explicitly uncertain provider billing outcome, but no unresolved tool-effect uncertainty may be treated as safely undone. P0-09 must refine tool settlement before tools are enabled.

## 5. Turn, step, and attempt lifecycle

### Turn

queued → active → answered | yielded | canceled | failed

A turn starts when an eligible input batch is atomically claimed. answered means the response was accepted into the conversation—not that the task is complete. yielded means work stopped at a declared boundary such as pause/block. Additional queued follow-up starts a later turn, never mutates the consumed input of an old turn.

### Step

planned → active → completed | failed | canceled | interrupted

Each step has a kind, ordinal, operation identity, input snapshot reference, expected result contract, and retry policy. Retry reuses the same StepId and creates another AttemptId. A different prompt/context caused by steering creates a new step, not a disguised retry.

### Attempt

created → dispatching → active → succeeded | failed | canceled | interrupted | outcome-unknown

Commit dispatching before calling an adapter. This does not prove a remote request was sent: a crash between commit and dispatch is intrinsically ambiguous. Recovery uses adapter reconciliation where available; it does not infer network reality from the event alone.

No attempt transitions out of its terminal outcome. Late results carry the old AttemptId/DriverEpoch and are rejected from canonical mutation. Reconciled metadata may be recorded through a separate trusted reconciliation fact when needed.

A retryable failed attempt does not fail the step immediately. The next retry is explicitly scheduled after classification and budget checks. A successful attempt must pass response/result validation before the step can complete.

## 6. Durable inbox and instruction queue

### Item types

- objective: starts a new task/run when explicitly requested.
- follow-up: applies to the next unclaimed turn.
- steering: applies at the next safe preparation boundary of a specified active run.

Each item references protected ContentId and carries trusted scope, RequestId, item type, target RunId when required, enqueue position, revision, and disposition. Bodies stay outside structural events.

### Dispositions

queued → claimed → applied

queued may become canceled or superseded. Claimed/applied input cannot be edited in place. An edit creates a protected new revision; the old structural history remains unchanged. Cancellation of a claimed item requires a run control action, not retroactive removal from a dispatched prompt.

### Ordering and ownership

- FIFO by committed enqueue position within each eligible class, not client timestamp.
- Steering is selected before ordinary follow-up at the next preparation boundary; it cannot starve cancellation or budget enforcement.
- Claim inputs, create the turn, and snapshot the exact revisions in one transaction.
- New steering never alters an active provider request. It waits unless the user explicitly pauses/cancels that operation.
- Canceling a run does not silently execute its unclaimed follow-ups in another run. Keep them held and show their disposition.
- Default backlog bound: 128 queued items per session; protected text uses P0-04 input limits. Overflow rejects without mutation.
- Default fairness: round-robin runnable sessions with a global active-run bound; no unbounded background agent launch.

The existing submit_message remains a conversation mutation and retains P0-01 semantics. Do not silently start a run on every message. Run creation links to an authorized MessageId/ContentId or separately enqueues explicit input through reviewed commands.

## 7. Transition engine and durable scheduling

Use one deterministic reducer plus a trusted effect planner:

```
committed events + protected references + validated command/outcome
→ legal transition decision
→ atomic events / protected writes / receipt / projection / checkpoint
→ commit
→ execute bounded effect with operation identity and epoch
→ validate outcome
→ next atomic transition
```

The reducer never performs HTTP, SQL, filesystem, vault, or tool calls. Ports expose effects; adapters implement them. The composition root owns wiring.

Persist pending operation and retry/deadline information so a crash can reconstruct runnable work. A in-memory channel is only a wake-up mechanism. Notification delivery is not authority.

Driver ownership uses a monotonic persisted epoch/fencing token. Recovery invalidates the old owner before claiming a new one. Heartbeats/leases may detect stalled drivers but are not authorization by themselves. All asynchronous outcome commits check epoch, active AttemptId, expected aggregate revision, and immutable scope.

One local application instance owns the writable scheduler baseline. If multiple-instance control is unavailable on a platform, enforce equivalent storage ownership or block the second writer; do not assume a SQLite write lock alone prevents duplicate external dispatch.

## 8. Provider boundary and normalized outcomes

P0-07 defines behavioral requirements, not a concrete network client. P0-08 owns exact provider types and adapters.

The runtime requires:

- scoped request/context snapshot and stable OperationId;
- declared adapter cancellation/reconciliation/idempotency capabilities;
- normalized bounded stream and response events;
- finish classification and output validity;
- safe error class and optional retry guidance;
- usage/cost values with known/estimated/unknown status;
- no automatic hidden adapter retry or provider fallback.

A provider finish marker is not task completion. Truncated, malformed, filtered, interrupted, or incomplete-tool output cannot satisfy an ordinary success contract.

Local-to-cloud fallback is never a retry of the same request under ambient settings. It is a new authorized selection and step with an explicit privacy decision. No fallback is implemented in P0-07.

## 9. Streaming persistence and UI contract

### Three output classes

1. **Volatile preview:** not committed; UI labels it live/uncommitted and it may disappear after crash.
2. **Committed attempt prefix:** protected chunks persisted for inspection/recovery; may be partial and is not yet an accepted assistant answer.
3. **Accepted response:** validated complete content linked into canonical conversation by a structural fact.

The UI must never conflate these classes. Attempt output is not fed into future authoritative context by default.

### Chunk policy

Initial configurable baseline:

- Coalesce received data and flush at 32 KiB or 250 ms from the first buffered data, whichever comes first while data continues arriving.
- Flush on clean finish, cancellation settlement, pause interruption, and recoverable stream failure when storage remains available.
- Chunk ordinals are contiguous per attempt, assigned by the backend.
- Atomic flush stores protected chunk bytes and a structural progress fact containing references/ordinals only.
- Default cumulative text output limit: 4 MiB per attempt; default unpersisted receive buffer limit: 256 KiB. Budget/token limits still apply.
- Apply bounded backpressure; if a source cannot be slowed and the bound is reached, stop the attempt with an explicit output-limit result.
- No raw tokens/prompts in logs or notifications.

The 250 ms interval is a flush target, not a durability SLA. Only committed-prefix indicators imply durability. Storage failure stops consumption/dispatch; do not continue collecting an unbounded volatile answer.

### Retry visibility

A failed partial attempt remains inspectable but is labeled failed/interrupted. A replacement attempt has a new identity and separate preview. Never concatenate the two responses or publish the replacement as if it continued the old bytes.

Only one winning validated response is accepted for a logical model step. Duplicate/stale callbacks cannot append another assistant message. Partial structured/tool arguments are never executable.

On crash, committed prefixes survive; the uncommitted tail may be lost. On normal cancellation, preserve received data that can safely be committed, label it partial, and do not mark it complete. No product claim promises lossless streaming through power failure.

## 10. Retry policy

### Classification

| Outcome | Baseline action |
| --- | --- |
| Definitely not dispatched, transient local admission failure | Retry if budget/policy permit |
| Transient provider failure with no accepted final response | Retry only under explicit model-request replay policy |
| Authentication, schema, capability, policy, validation failure | Block/fail; no automatic retry |
| Rate limit | Honor bounded provider delay and retry budget |
| Unknown commit/result | Reconcile original operation/receipt first |
| Uncertain side-effecting operation | Block; no blind repeat |
| Context-length failure | New context-preparation step under approved policy; not an identical retry |

Default model-operation retry ceiling: 3 total attempts, including the first. Backoff baseline: exponential from 500 ms, full jitter, capped at 30 seconds; bounded retry-after may extend within the overall deadline. Inject randomness/time in tests. Persist retry scheduling decisions; do not draw a new delay on every replay.

All attempts consume attempt/time budget; failed requests may consume provider token/cost budget. Unknown usage is recorded as unknown with a conservative reservation—never zero by assumption.

Pause/cancel overrides scheduled retry. Retries never change input snapshot, provider privacy class, approved endpoint, or capabilities. Any change requires a new authorized step and recorded decision.

## 11. Pause, resume, cancel, and shutdown

### Pause

- Persist request before acknowledging.
- Stop creating new attempts immediately.
- If no operation is active, checkpoint and enter paused.
- For a model stream, request adapter cancellation, save the committed prefix, and close the attempt as interrupted-by-pause.
- A canceled stream is not resumable at the byte position unless the provider explicitly supports a validated continuation protocol. Baseline resume starts a new preparation/model step with the partial attempt excluded from accepted conversation context.
- For future tools, pause waits for a safe tool boundary or approved cancellation protocol. It never pretends a process was rolled back.
- Remain pausing until active work is settled. A hung adapter becomes a recovery/blocking condition, not a fake paused state.

### Resume

Validate checkpoint version, scope, content/key availability, remaining budget, agent/config compatibility, and current policy restrictions. New restrictions apply immediately; new permissions are not inherited automatically. Keep historical snapshots intact and append an explicit replacement snapshot when approved configuration changes are required.

### Cancel

Persist intent, signal cancellation, stop retries/new turns, reconcile outcomes, preserve partial evidence, and commit canceled once safe. Cancellation does not delete the conversation or undo a completed remote side effect. Late completion cannot override a committed cancel intent.

Default local adapter cancellation settlement target: 5 seconds. This is not proof of remote termination. On expiry, fence/detach the local task, record uncertainty, and block unsafe future effects. Future process tools require P0-09 process-tree termination and reconciliation.

### Application shutdown

Stop new admission, request pause for active runs, and attempt bounded checkpoint/settlement within a default 5-second shutdown grace. Preserve earlier cancel intent. If the process exits before safe completion, startup recovers from the last commit; never append a successful pause merely because shutdown was requested.

## 12. Checkpoints

Checkpoint data is a protected, versioned state artifact plus a structural checkpoint/created fact.

Required fields:

- scope and run/task/turn identifiers;
- last source sequence/global position and reducer/checkpoint format versions;
- driver epoch and aggregate revision;
- lifecycle/phase/control intent;
- inbox claims/applied revision references;
- agent/context/policy/completion-contract snapshot references;
- steps/attempts/operation outcomes and pending reconciliation;
- committed output chunk references;
- budget counters/reservations and deadline policy;
- retry scheduling decision and safe next action.

Checkpoint content contains no credentials or executable closures. Private context remains protected and referenced. Restore validates checksums, schemas, scope, source-prefix consistency, and policy; it never authorizes execution merely because a snapshot exists.

Safe boundaries include before dispatch after intent commit, after a validated operation result, before pause, before verification, and before terminalization. Streaming chunk flushes provide prefix recovery but do not make an active operation safely repeatable.

Events remain authoritative. A stale/missing checkpoint can be rebuilt. A checkpoint ahead of canonical history is rejected. Replay never performs effects.

## 13. Crash recovery algorithm

1. Acquire exclusive scheduler ownership and fence prior epochs.
2. Verify storage/event compatibility and affected stream integrity; stop if canonical state cannot be trusted.
3. Rebuild runtime/inbox/budget projections from events; validate usable checkpoints.
4. Move interrupted active runs into recovering with persisted pre-crash control intent.
5. Classify each recorded operation: not-dispatched, settled, interrupted, or outcome-unknown.
6. Use safe adapter reconciliation where available; never replay solely because an attempt lacks a completion fact.
7. Honor cancel first, then pause. Do not resume work the user asked to stop.
8. Restore committed prefixes without promoting them to accepted answers.
9. Validate current policy, protection/key access, deadlines, and remaining budgets.
10. Commit the recovery decision before any new effect.
11. Present blocked/recoverable state and permitted next actions.

Default startup behavior is **recover then hold paused** for interrupted runs. User resumes explicitly. Optional future auto-resume requires a pre-existing, scoped policy and only applies to operations proven safe to repeat; it is not enabled by this specification.

Crash windows to model explicitly:

- after input claim, before preparation;
- after dispatch intent, before actual call;
- after remote dispatch, before first persisted delta;
- after chunk write, before UI notification;
- after provider final result, before result commit;
- after result commit, before conversation notification;
- after verification outcome, before terminalization;
- after cancellation intent, before settlement;
- after terminal commit, before response delivery.

Loss of an acknowledgement uses the same RequestId/OperationId reconciliation path; a new identifier is not a recovery shortcut.

## 14. Budgets and deadlines

Budget values are frozen at run start, bounded by global/admin policy, and amended only through explicit trusted commands. Missing required values block dispatch.

Required dimensions:

- total turns, steps, and attempts;
- model input/output/total token ceilings;
- active-execution duration and absolute expiry;
- monetary spending limit for paid providers;
- output/storage bytes;
- concurrent operations and queued input count.

Suggested initial development profile: 32 steps, 64 attempts per run, 3 attempts per model operation, 10 minutes active execution, 24 hours absolute expiry, 4 MiB text output per attempt, and one active attempt per run. Token ceilings must fit the selected model/context and be explicitly provided. Paid operation requires an explicit nonnegative monetary budget and pricing/unknown-cost policy; there is no implicit unlimited spend.

Reserve resources before dispatch and settle actual usage afterward. Counters, reservations, and attempt admission are atomic. A crash retains reservations until reconciliation; restarting cannot reset a budget. Cross-run/project concurrency shares a trusted global cap.

Use checked integer/fixed-decimal accounting, not floating-point money. Unknown provider price/usage cannot be represented as free. P0-08 owns conservative estimation and provider reporting details.

Use monotonic time during process lifetime. Persist elapsed accounting and absolute UTC expiry; record clock anomalies. Pause excludes idle time from active budget but not absolute expiry. If a crash leaves elapsed time unknown, apply a conservative documented charge or block for review—never grant a fresh full budget. Clock rollback cannot extend authority silently.

Exhaustion stops new effects, settles active work, and enters blocked(budget-exhausted) or terminal/failed if continuation is disallowed. Budget exhaustion never becomes completed. Budget extension needs explicit authority and remains within hard policy bounds.

## 15. Repetition and no-progress control

Maintain versioned progress/repetition metrics from committed state:

- normalized operation/input fingerprints scoped to a run;
- repeated error-class outcomes;
- completed step/result references;
- verified objective evidence and valid state advancement;
- consecutive steps without substantive progress.

Baseline triggers:

- Three equivalent operation proposals without changed inputs/evidence → repetition guard.
- Five completed reasoning/observation steps without new evidence or state progress → no-progress guard.
- Hard step/attempt/time limits always take precedence.

New prose, a new AttemptId, or claims that progress occurred do not reset the counter. Protected/keyed fingerprints are required for private input; never log content-derived raw hashes as diagnostics.

On trigger, stop admission, checkpoint, and enter blocked(no-progress/repetition) with a safe explanation and evidence references. One future approved replanning action may create a new step, but cannot reset total budgets or create an unbounded self-repair loop. Tools will refine repetition semantics in P0-09. Detection is a guardrail, not proof of correctness.

## 16. Verification-gated completion

The model produces a CompletionProposal containing protected answer/output references and claimed evidence references. It cannot choose terminal state.

The trusted verifier evaluates the frozen CompletionContract and returns:

- pass → completed;
- pass-with-permitted-warnings → completed-with-warnings;
- fail → failed-verification, or an explicitly bounded remediation step;
- unavailable/insufficient evidence → blocked(verification-required).

Warnings cannot excuse an unmet mandatory safety requirement. A mandatory failure cannot be relabeled as a warning by the model or renderer.

Terminalization requires: settled operations; no pending cancellation; required input applied/disposed; accepted response/output; verified scoped evidence; budget accounting settled or explicit permitted uncertainty; one completion-determined fact.

P0-07 implements this port and tests it with deterministic fixtures. An always-pass production verifier is prohibited. Until P0-10 provides real task-specific verification, production tasks requiring unavailable checks remain blocked. Do not advertise coding-task completion from a mock verifier.

Remediation is bounded by the same run budget and a contract-specified count; initial default is zero automatic remediation cycles. A later authorized cycle records verifier findings and creates a new step.

## 17. Runtime event registry extension

The following are proposed v1 facts for review before implementation. They extend the P0-02 registry and do not change the meaning of existing facts.

| Family | Events |
| --- | --- |
| Inbox | input/queued, input/revised, input/claimed, input/applied, input/canceled, input/held |
| Task/run | task/created, run/queued, run/claimed, run/blocked, run/block-resolved, run/recovery-started, run/recovery-resolved |
| Controls | run/pause-requested, run/paused, run/resumed, run/cancel-requested, run/canceled |
| Turn/step | turn/started, turn/completed, step/started, step/completed |
| Attempt | attempt/started, attempt/dispatch-recorded, attempt/failed, attempt/completed, attempt/retry-scheduled, attempt/reconciled |
| Output/context | context/snapshot-created, model/stream-progressed, model/responded, assistant/response-accepted |
| Checkpoint/budget | checkpoint/created, budget/reserved, budget/settled, budget/limit-reached, progress/guard-triggered |
| Verification | verification/started, verification/completed, task/completion-determined |

Use explicit outcome/reason enums for turn/step/attempt closure; do not overload completed to imply success. Define canceled/interrupted/unknown statuses in each schema. run/canceled closes cancellation; task/completion-determined records the run-linked overall terminal verdict exactly once. Registry review must reconcile these names with reserved P0-02 families rather than producing duplicate competing terminal events.

Each runtime fact carries only relevant typed IDs, revisions, safe status/reason codes, resource counts, content/artifact references, snapshot/version references, and causation. Event type/version remain separate. No prompt, raw stream text, provider body, secret, or raw path is embedded.

Runtime projection consumers validate completeness and compatibility. Unknown future runtime events block the affected runtime; opaque diagnostics may preserve them but cannot guess transitions.

## 18. Proposed domain commands and IPC amendment

Application commands:

- StartRun: scoped MessageId/objective reference plus approved agent and budget profile.
- EnqueueRunInput: protected steering/follow-up body, kind, target, and revision expectations.
- ReviseQueuedInput / CancelQueuedInput: only unclaimed revisions.
- PauseRun / ResumeRun / CancelRun.
- ResolveRunBlock: typed resolution for the exact current reason/revision, not a generic override.
- GetRunState / GetRunOutputPage: safe scoped projections with bounded output.

All mutating commands use versioned DTOs, RequestId idempotency, trusted actor resolution, immutable scope, expected revision where needed, and safe receipts. Same ID/different scope or payload conflicts. Resume/cancel acceptance returns committed control status, not a promise that remote work has already stopped.

These commands are **not authorized additions to the existing seven-command Tauri allowlist** merely because they appear here. Before exposing them, amend P0-04 with exact DTOs, limits, errors, runtime validators, window permissions, pagination, notification schemas, and tests; generate bindings and review capability files together.

No generic set_state, append_runtime_event, resume_checkpoint_path, execute_tool, or dispatch_service endpoint is allowed. Run output pages may reveal authorized content, but state/notification metadata does not contain it.

## 19. Rust module and port boundaries

```
crates/adham-runtime/src/
├── lib.rs
├── domain/
│   ├── identity.rs
│   ├── run.rs
│   ├── turn.rs
│   ├── step.rs
│   ├── attempt.rs
│   ├── inbox.rs
│   ├── transition.rs
│   ├── budget.rs
│   └── progress.rs
├── application/
│   ├── driver.rs
│   ├── controls.rs
│   ├── scheduling.rs
│   ├── streaming.rs
│   ├── retry.rs
│   ├── checkpoint.rs
│   └── recovery.rs
├── ports/
│   ├── persistence.rs
│   ├── model.rs
│   ├── context.rs
│   ├── verification.rs
│   └── clock.rs
└── tests/
```

Create only modules used by the kernel. Persistence exposes atomic runtime transactions with events/protected content/receipts/projections, not separate independently committing writes. Clock/randomness are injectable. Model and verification fakes live in tests/development adapters, not production policy.

Runtime does not import Tauri, concrete provider HTTP clients, SQLx transactions, OS paths, browser code, or tool execution implementations. Concurrency/cancellation mechanisms are application infrastructure; they cannot replace durable control intent. Avoid one giant loop file: target under 300 lines; review above 400; require documented exceptions above 600.

## 20. Required test matrix

| Area | Required evidence |
| --- | --- |
| Transition legality | Every allowed edge; every forbidden edge; terminal immutability; phase/lifecycle consistency |
| Property tests | No terminal reopening, double active attempt, double claimed input, budget reset, or scope drift across generated command traces |
| Replay | Same log yields identical runtime/inbox/budget projections; replay produces zero external effects |
| Idempotency | Duplicate controls/start/enqueue return original acceptance; altered scope/payload conflicts |
| Races | Pause vs dispatch; cancel vs completion; resume vs stale callback; steering vs input claim |
| Driver fencing | Old epoch/outcome rejected; second scheduler cannot duplicate dispatch |
| Streaming | Coalescing boundaries, chunk order, duplicate callback, backpressure, size limit, committed vs volatile output |
| Retry | Partial failed output separate from replacement; persisted backoff; limits; no retry after pause/cancel |
| Fault injection | Fail before/after every state/content/receipt/checkpoint commit; dispatch disabled after storage failure |
| Process crash | Kill at every listed recovery window; startup holds/reconciles without duplicate accepted answer |
| Cancellation | Prefix preserved; late callbacks ignored; remote uncertainty represented honestly; bounded local settlement |
| Pause/resume | No active work in paused; new step after interrupted stream; policy/key/budget checks enforced |
| Inbox | FIFO/class ordering; queued revision; claimed edit rejected; held follow-up not silently transferred |
| Budget | Reservation/settlement atomic; unknown usage not zero; restart no reset; expiry/clock rollback; hard cap |
| No-progress | Thresholds deterministic; new prose/AttemptId not progress; total budget unchanged after replan |
| Checkpoints | Stale rebuild; ahead rejected; wrong scope/version/key rejected; no effect during restore |
| Completion | Model proposal alone cannot complete; mandatory failure never warning; unavailable verifier blocks |
| Privacy/isolation | Two projects cannot share input/output/context/queries; structural events/logs/notifications free of canary text |
| Compatibility | Future event/checkpoint versions block safely; old stored bytes remain unchanged |

Use deterministic simulated time/adapters first, then process-kill integration tests against temporary protected storage. Assertions check durable rows/events and absence of forbidden effects—not only UI labels. Platform-native runtime control tests must distinguish real IPC from mocked renderer tests.

## 21. Acceptance and staged implementation order

### Specification acceptance

- [ ]  Identity/object hierarchy and session-stream ownership accepted.
- [ ]  Lifecycle/phase/control precedence and transition table accepted.
- [ ]  Inbox application/editing/cancellation semantics accepted.
- [ ]  Epoch fencing and transaction/effect ordering accepted.
- [ ]  Streaming durability classes and retry visibility accepted.
- [ ]  Checkpoint/recovery/uncertain-outcome policy accepted.
- [ ]  Budgets, default limits, clock rules, and progress guards accepted.
- [ ]  Completion-verifier boundary accepted.
- [ ]  Event schemas/registry and IPC amendment reviewed before exposure.

### Kernel execution order

1. Pure reducer and transition/property tests.
2. Runtime event schemas/registry and deterministic replay projection.
3. Atomic inbox/run commands and persistence integration.
4. Driver epochs, scheduler ownership, bounded wake-up queues.
5. Fake model loop and protected streaming persistence.
6. Retry, budgets, pause/cancel, and race tests.
7. Checkpoints, restart recovery, and process-kill matrix.
8. Verifier port, false-completion prevention, and fake-verifier tests.
9. Reviewed typed IPC/UI state extension and native control smoke tests.
10. Evidence review before P0-08 connects an actual provider.

### Kernel completion gate

- [ ]  P0-06 persistence/privacy gates remain green.
- [ ]  All state/race/replay/fault/recovery tests pass for the tested revision.
- [ ]  No external effects are replayed blindly and no stale driver may commit outcomes.
- [ ]  Partial streaming output is preserved/labeled correctly without duplicate accepted responses.
- [ ]  Pause/cancel requests survive restart and cannot be overridden by late model callbacks.
- [ ]  Budgets and inbox claims survive crashes without reset or scope drift.
- [ ]  Completion requires a trusted verifier; fixture evidence is not a production-completion claim.
- [ ]  Real native control evidence exists for declared validated platforms.
- [ ]  Required skipped/failing checks remain explicit blockers.

## 22. Stop conditions and next artifact

Stop dispatch and preserve durable state when storage/integrity is unsafe, ownership is lost, identity mismatches, protection/key access fails, budget accounting is indeterminate, replay semantics are unsupported, or an external outcome cannot safely be repeated. Do not add broad permissions, reset budgets, delete history, concatenate partial retries, or replace verification with model confidence to bypass a blocker.

The next specification is **P0-08 — Provider gateway and normalized stream contract**. It must define the provider port, capability/model metadata, request/response normalization, usage/cost uncertainty, cancellation/reconciliation support, retry classifications, privacy-boundary routing, and an Ollama Local-first integration. This runtime spec does not authorize live provider calls, tools, or background autonomy.