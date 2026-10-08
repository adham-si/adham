<aside>
🔁

Companion to P0-07 (loop-mechanics angle). Research matrix only — it authorizes no runtime
code, no provider calls, no tool execution, no background autonomy.

</aside>

# P0-07 — Agent loop mechanics wiring matrix

## 1. Purpose and boundaries

This document is the second research companion to `P0-07 — Agent runtime state machine`,
covering the loop-mechanics angle: how one iteration is wired (prompt rendering, model call,
action parsing, tool dispatch, observation feeding), when the loop stops, how steering
enters mid-loop, and how per-step behavior adapts. The sibling `P0-07 — Agent runtime wiring
matrix and kernel skeleton` covers lifecycle, state, budgets, and recovery — this matrix
covers what happens inside `running` between two checkpoints.

- **Status:** research only. It authorizes no runtime code, provider calls, tool execution,
  or background autonomy. Stop-condition and callback names below are design inputs, never
  imported APIs.
- **Scope:** the single-agent tool loop — ReAct-style thought→action→observation cycles,
  planning cadences, loop strategies, composable stop conditions, per-step hooks, parallel
  vs sequential tool dispatch, submit/final-answer signaling, steering injection. Multi-agent
  orchestration stays P0-11; tool policy stays P0-09; completion stays P0-10.
- **Loop maxim:** the loop is a runtime-owned `while` with explicit continuation, not model
  goodwill. Every iteration is budgeted, every exit is a decided stop condition, and a model
  that stops calling tools has paused — never finished.
- **Data hygiene:** all thresholds, prompts, and tool names are synthetic placeholders. No
  real prompts, user content, or machine paths.
- **File-size note:** target under 600 lines; split per mechanism before review if it grows
  past that.

## 2. Shared loop schema

One iteration has exactly five stages: render authorized memory into messages → model call
under frozen snapshot → parse exactly one action batch → dispatch tools through
schedule/policy/grant → append action + observations to the log. Reasoning text is never an
action; unparsed chatter never dispatches.

### 2.1 Log step kinds

| Step | Content |
|---|---|
| `SystemPromptStep` | Frozen reviewed instructions for the run |
| `TaskStep` | Claimed user objective + input batch |
| `ActionStep` | Thought + parsed action batch + tool observations + timing/usage |
| `PlanningStep` | Periodic facts list + reflection on next steps (cadence-gated) |

Memory writes to messages each iteration (`write_memory_to_messages` pattern); observations
return as tool results, never as new instructions. Planning steps feed facts forward without
replacing action history.

### 2.2 Loop state (per run, trusted counters)

`iteration`, `toolCallCount`, `lastStopReason`, `contextUsagePercent`, plus references to the
active step/attempt, pending approval state, and repetition fingerprints. Counters live in
runtime-owned state, are committed with transitions, and survive recovery — the model never
reports its own iteration number as authority. A fresh task resets loop state explicitly;
loop detectors keep a bounded window (e.g. last 10 turns/calls) that resets only on task
boundaries, never silently mid-task.

## 3. Loop wiring matrix

Conventions mirror the earlier matrices: each mechanism names its owner (loop driver vs
policy vs model), its durable records, and its bounds. Callback and strategy names from
frameworks are vocabulary, never dependencies.

### 3.1 Loop strategies (what `while` means)

The strategy controls iteration/tool-call ceilings and the stop predicate, evaluated from
trusted `LoopState` after every turn. Profiles: `default` (stop only when the model stops
requesting tools or an error/abort fires — Adham permits this profile only inside hard
outer budgets, never bare, and stopping here ends the turn as paused/yielded pending an
explicit completion signal, never the task — task completion still needs the P0-10 verdict
path); `tool-heavy` (high but finite ceilings, e.g. 25 iterations /
50 tool calls, for coding agents); `retrieve-then-respond` (one tool pass, then a
tool-free final response, for knowledge agents). An explicit `submit()`/final-answer tool
call is the preferred completion signal over tool-silence: models that stop calling tools
without submitting are nudged to continue (`on_continue` message or callable returning
continue-with-message / exit-early / state-update), because silence is ambiguous between
done, stuck, and distracted. `max_steps`-style fallbacks must still run final-answer
checks — a fallback answer that skips validation is a finding, not a completion.

### 3.2 Composable stop conditions

The loop continues while tool calls occur and stops on: non-tool-call finish reason; an
invoked tool with no execute function (manual-loop handoff); a pending approval request;
or any satisfied stop condition. Conditions compose as any-match arrays: step count
(`isStepCount(20)`-class default for tool loops — a safety measure against runaway API
costs, raisable explicitly, e.g. 50 for research tasks); tool-call markers
(`hasToolCall('done')` for explicit completion tools); budget predicates (custom
conditions over accumulated input/output tokens per step); evaluator predicates
(marker/todo/background-task completion with feedback messages for the next input).
`isLoopFinished`-class never-stop conditions are forbidden in Adham profiles — natural
finish is not a bound. Precedence is single and documented: call-site conditions override
agent-level ones, never merge ambiguously (the documented `stopWhen`-overrides-`maxSteps`
confusion class must be impossible — one composed predicate, evaluated in one place, with
the losing bound recorded as configuration, not silently dropped).

### 3.3 Per-step hooks (adaptation points, all policy-gated)

- **Prepare-step:** recompute per-step settings from `(stepNumber, steps)` — active tool
  subset by phase (search → analyze → summarize), forced tool choice (`required` during
  evidence-gathering phases), model selection, message modification, sandbox selection.
  Phase-gated tools keep the per-iteration tool surface minimal.
- **Before/after model:** validate/transform the outgoing request (input guardrails,
  keyword blocks) and inspect the response (refusals, malformed actions → corrective
  re-prompt, never silent dispatch).
- **Before/after tool:** check arguments against policy (argument guardrails, blocked
  destinations), then record observations with timing/usage. Tool-approval requests escape
  the loop to the caller instead of hiding behind another autonomous iteration; the loop
  resumes only through the normal approval-response flow.
- **End-of-turn:** run loop-pattern detection (identical repeats, cyclic patterns, idle
  status-check loops), update repetition fingerprints, flush streaming prefixes per the
  chunk policy. Non-empty advisory reasons inject as nudges; blocking reasons replace tool
  execution with the reason as the observation.
- **Planning cadence:** periodic planning steps every N action steps (e.g. 3–5) revise the
  facts list and next-step reflection; planning-interval callbacks can interrupt for review.
  Planning never rewrites action history — it appends facts forward.

### 3.4 Tool dispatch within a step

One parsed action batch may contain several tool calls. Sequential by default; parallel
only for calls declared parallel-safe, within a configured bound, preserving model order
where order matters. Partial-batch failure settles per call (success observations commit,
failed calls classify for retry policy) — a batch never half-applies silently. Unknown or
unavailable tools never dispatch: the unknown-tool guard converts repeated
not-found failures into a critical blocker with a stop-retrying message, and rewrites
persisted hallucinated calls into plain text rather than re-attempting them. Execution
environment matches the action kind: shell-free structured calls through the P0-09 broker;
code actions (if a future code-action profile exists) only inside E2B/Docker-class
sandboxes with authorized imports — never host interpreters.

### 3.5 Steering injection points

Follow-up and steering items enter only at preparation boundaries, never into an active
provider request: steering waits for the next safe boundary unless the user explicitly
pauses/cancels the operation. `on_continue`-class hooks append guidance messages when the
model stalls without tool calls; evaluator feedback (`(continue, feedback)` returns)
becomes the next input. New steering never edits claimed inputs, never alters dispatched
prompts, and never resets loop counters — it is new information for future iterations,
applied through the inbox transaction from the runtime matrix.

## 4. Loop safety controls

The loop is where dollars burn and evidence dies. Each control answers a documented incident.

1. **Repetition circuit breaker.** Track tool name + normalized args hash + error in a
   sliding window; 3 identical failing calls (or 3 idle-only turns, or cyclic turn patterns
   in a 10-turn window) blocks the call and feeds the reason back as the observation, then
   escalates to user pause on defiance. Answers: AppleScript same-error 3+ retries to rate
   limits; read_file(config) infinite re-reads; submit-batch death spirals; status-tool
   idle loops. Detection state is runtime-owned and reset only at task boundaries —
   compaction must never erase the failure ledger that proves the loop exists.
2. **Unknown-tool breaker.** Repeated not-found failures become a critical blocker with a
   stop-retrying message after a threshold (default 3), always-on even when loop detection
   is otherwise disabled; hallucinated calls in streams rewrite to plain text. Answers the
   754-retry / 3.57M-token / ~$70 WebSearch-not-found incident and stale skill snapshots
   that rename tools out from under running loops.
3. **Single precedence for bounds.** One composed stop predicate, one evaluation point,
   documented override order with the losing bound logged. Answers the
   stopWhen-overrides-maxSteps confusion where a 5-step cap silently lost and the loop ran
   past it — in Adham an unsatisfiable-looking bound pair fails configuration review
   instead of running.
4. **Explicit completion signaling.** Prefer `submit()`-class tool calls over tool-silence;
   nudge on silence; run final-answer checks even on max-steps fallback. Answers models
   that announce tool calls in prose and then stop, and fallback answers that skip
   validation (smolagents #2686 class).
5. **Approval escapes the loop.** Pending approvals return to the caller; the loop never
   iterates around an approval gate, and loop wrappers sit outside approval enforcement.
   Answers hidden-behind-iteration approval bypasses (Microsoft LoopAgent/ToolApprovalAgent
   ordering lesson).
6. **Bounded planning and batching.** Planning cadence fixed (3–5 action steps), parallel
   batches bounded and order-preserving, phase-gated tool subsets. Answers runaway
   critique-refine loops without `max_iterations` + `exit_loop`, and full-toolset
   per-iteration bloat.
7. **Model-smartness independence.** “Smarter model stopped looping” is not a control —
   bounds, breakers, and precedence hold for every model, every run.

## 5. Loop skeleton, risk log, sources, and open decisions

### 5.1 Skeleton (names only — no code authorized)

Lives inside `adham-runtime` application layer (sibling to `driver.rs` from the runtime
matrix doc), all wired through the reducer + ports — no new crate:

```
crates/adham-runtime/src/application/
├── driver.rs        # Turn/step/attempt advancement (existing)
├── loop_strategy.rs # Profiles: default / tool-heavy / retrieve-then-respond; LoopState
├── stop.rs          # Composed stop predicate: step count, tool markers, budget, evaluators
├── step_hooks.rs    # prepare-step, before/after model/tool, end-of-turn detection
├── planning.rs      # Planning cadence, facts list, reflection appends
└── steering.rs      # on-continue nudges, inbox injection at preparation boundaries
```

Rules: strategy and predicates are pure functions over trusted `LoopState`; hooks call
policy/observation ports, never provider/tool clients directly; detector windows persist
with transitions; per-step tool subsets derive from the approved registry snapshot.
Framework reference points (vocabulary only): smolagents `MultiStepAgent` cycle
(memory→messages→completion→parse→execute→callbacks) with `planning_interval` +
`max_steps` + `step_callbacks`; ADK `LoopAgent(max_iterations)` + `exit_loop` escalation
tool + `SequentialAgent` pipelines + before/after model/tool callbacks; AI SDK
`ToolLoopAgent` (`stopWhen`, `prepareStep`, `toolApproval` escaping the loop); Microsoft
Agent Framework `LoopAgent` evaluators + `AgentLoopMiddleware`; Inspect `react()` +
`submit()` + `on_continue`.

### 5.2 Risk log (signal → Adham rule)

| # | Signal | Adham rule |
|---|---|---|
| L1 | Same-error retries to rate limits; identical/cyclic/idle loops | §4.1: windowed breaker + escalation, compaction-proof ledger |
| L2 | 754 unknown-tool retries, 3.57M tokens, ~$70 | §4.2: always-on unknown-tool breaker + stream rewrite |
| L3 | stopWhen silently overriding maxSteps past 5 | §4.3: single composed predicate, logged precedence |
| L4 | Prose-announced tools never called; unchecked fallback answers | §4.4: submit-signaling, silence nudges, fallback checks |
| L5 | Iterations hiding approval gates | §4.5: approvals escape, loop outside enforcement |
| L6 | Unbounded critique-refine loops; full toolset per step | §4.6: iteration caps, exit tools, phase-gated subsets |
| L7 | Compaction erasing failure evidence mid-loop | §4.1: failure ledger outside compacted context |
| L8 | “Smarter model fixed it” non-controls | §4.7: model-independent bounds |

### 5.3 Sources

- Context7: `/huggingface/smolagents` (ReAct cycle, `MultiStepAgent` steps/callbacks,
  `planning_interval`, `max_steps`, CodeAgent vs ToolCallingAgent); `/websites/adk_dev`
  (`LoopAgent` + `exit_loop` escalation, `SequentialAgent` pipelines, lifecycle + tool
  callbacks, guardrails); `/vercel/ai` (`ToolLoopAgent`, `stopWhen` conditions,
  `prepareStep` phasing, `toolApproval` escape flow).
- Live channels (`agent-reach doctor` 4/16 verified earlier: V2EX, RSS, Jina Reader,
  Bilibili-search; GitHub/YouTube/Exa + 9 login channels unavailable).
- Web: AI SDK loop-control docs (20-step default, WorkflowAgent unbounded warning);
  Microsoft Agent Framework looping (10-invocation default, evaluator feedback,
  approval-before-evaluation); Inspect `react()` + `submit()` + `on_continue` semantics;
  agent-loop-detector patterns (3/3/10 thresholds); OpenClaw #5962 stuck-loop proposal +
  #67399 circuit breaker (754×, 3.57M, $70) + shipped unknown-tool guard; get-convex
  #167 stopWhen/maxSteps precedence confusion; smolagents #2686 fallback-check skip.
- Repo: `P0-07 — Agent runtime state machine.md` (turn/step/attempt, inbox, engine,
  streaming, retry, pause/cancel, budgets, repetition); sibling runtime wiring matrix;
  audit mermaid control path (ENGINE → CTX → ROUTER / TOOLS → POLICY loop).

### 5.4 Open decisions (human-gated, unchanged)

Same six: Apache-2.0 license (no placeholder); Node 24 LTS; `ts-rs` for P0 IPC DTOs; manual
Vite + `pnpm tauri init`; domain-command boundary; dependency-set approval before any install.
Plus the numeric profile defaults above (25/50 tool-heavy ceilings, 3/3/10 detector
thresholds, 3–5 planning cadence) are research baselines awaiting P0-07 acceptance — not
approved constants.

This matrix authorizes nothing: no runtime code, provider calls, tool execution, background
autonomy, or new IPC surface.
