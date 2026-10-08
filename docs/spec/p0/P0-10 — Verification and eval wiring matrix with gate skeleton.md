<aside>
✅

Companion to P0-10. Research matrix only — it authorizes no test execution, installs,
reads, publishing, commits, or patch application.

</aside>

# P0-10 — Verification and eval wiring matrix with gate skeleton

## 1. Purpose and boundaries

This document is the research companion to `P0-10 — Verification gate and evidence-backed
completion contract`. It answers one question: for each verification and eval mechanism, which
settings must be wired, which separate files own each piece, and which integrity controls come
first.

- **Status:** research only. It does not authorize executing tests, installing dependencies,
  reading additional folders, publishing, committing, or applying a patch. Verification actions
  stay subject to the same policy, approval, sandbox, resource, and privacy requirements as
  ordinary tools.
- **Scope:** the completion contract, verification plan, evidence provenance, check results,
  freshness/invalidation, scope preservation, verdict calculation, bounded remediation, durable
  completion transaction — plus the eval-harness layer (§4) that keeps Adham's own checks honest
  over time: benchmark selection, contamination guards, judge-bias controls, regression suites.
- **Initial target is unchanged:** coding tasks through the P0-09 broker and sandbox — verify
  an immutable proposed patch/snapshot, or the actual broker-applied deliverable, per the task's
  declared mode. Writing/research/action contracts are typed future extensions; no single coding
  checklist proves all work.
- **Completion mantra:** a trusted determination backed by fresh, scoped evidence — never a
  model statement, successful tool call, green screenshot, or zero exit code. Missing, stale,
  unsafe, or contradictory evidence cannot become success through confidence or wording.
- **Data hygiene:** all contracts, digests, verdicts, and scores here are synthetic placeholders.
  No real test results, user content, or machine paths.
- **File-size note:** target under 600 lines; split per family (gate / harness) before review if
  it grows past that.

## 2. Shared verification schema

The model proposes completion; only trusted verification/application services determine it.
Mandatory unmet requirements are never warnings; skipped/unavailable/unknown/stale required
checks block; hard gates (scope preservation, policy safety, unsettled effects, evidence
integrity) are nonwaivable.

### 2.1 Domain objects

| Object | Responsibility |
|---|---|
| `CompletionContract` | Versioned objective, requirements, mandatory checks, delivery mode, warning policy, acceptance authority |
| `AcceptanceCriterion` | Stable requirement with observable predicate or explicit human-review obligation |
| `VerificationPlan` | Concrete scoped checks, dependencies, environments, budgets |
| `CandidateDeliverable` | Frozen patch/snapshot/artifact or observed applied-result manifest under evaluation |
| `VerificationRun` | One bounded evaluation attempt for one contract/candidate revision |
| `CheckDefinition` | Reviewed validator/command/review obligation + result semantics |
| `CheckExecution` | One actual invocation/review with trusted provenance + captured output |
| `EvidenceRecord` | Immutable protected evidence + safe structural metadata |
| `Finding` | Scoped failed/blocked/warning condition with provenance + severity |
| `VerificationVerdict` | Trusted deterministic result from current applicable check results |
| `CompletionDetermination` | Atomic runtime terminal decision linked to verdict + deliverable |

IDs: `CompletionContractId, CriterionId, VerificationPlanId, VerificationRunId, CheckId,
CheckExecutionId, EvidenceId, FindingId, CandidateId`, preserving runtime `OperationId`/
`AttemptId` and driver epoch. Ownership: `adham-verify` owns domain rules + verdict math;
`adham-runtime` owns terminal lifecycle; tools/platform/sandbox own effects + capture;
protected artifact storage owns evidence bytes. The verifier never receives unrestricted SQL,
file, shell, provider, or vault access. Contracts freeze before substantial task effects;
amendments mint explicit new revisions with reasons, invalidate incompatible evidence, and
re-verify — terminal runs never reopen under changed contracts.

### 2.2 Delivery modes and verdict rules

| Mode | Handoff | May claim |
|---|---|---|
| `proposal-only` | Protected reviewed patch/artifact + exact baseline/candidate manifest | Proposal verified against recorded candidate; not applied |
| `apply-and-verify` | Broker-applied files with settled effects + applicable evidence | Changes applied and verified as of recorded observation |
| `artifact-only` | Exact generated artifact with structural/content validation | Artifact produced/validated for stated purpose |

No mode is ever assumed — the mode is always explicit in the frozen contract: never apply
a proposal because tests passed; staging-only build success proves nothing about native
installs, live repos, or releases. Verdict order:
hard gates (integrity/security/authority/unsettled effects → blocked with incident handling)
→ mandatory fails → fail; mandatory missing/running/skipped/stale/invalid → blocked;
all mandatory satisfied + no warnings → pass; + only permitted optional findings →
pass-with-permitted-warnings. The verdict is the first matching row above, while all
findings are retained — never hide proven failure
behind “environment unavailable.” P0-07 mapping: pass → completed; pass-with-warnings →
completed-with-warnings; fail → failed-verification or authorized bounded remediation;
blocked → blocked(verification-required). Cancel intent committed first always wins; pause
holds the run at a safe boundary.

### 2.3 Check taxonomy and result states

Check kinds: deterministic structural/content predicates; bounded command/test executions;
generated-contract/schema drift; diff/scope/preservation; security/policy/effect-reconciliation
gates; browser-renderer behavior; real native/platform behavior; approved external/CI evidence
imports; authorized human review; advisory model review. Results: `pending | running | passed |
failed | blocked | skipped | stale | invalid | canceled | not-applicable` — where
`not-applicable` needs a proven predeclared exclusion predicate (never chosen post-failure),
mandatory skipped checks block, expected-negative tests pass only on observed rejection plus
absent forbidden effects, and timeout/truncation/unparseable output is never pass even beside
printed success text.

## 3. Verification wiring matrix

Conventions mirror the earlier matrices: each mechanism names its owner, its durable records,
and its invalidation triggers. Criteria are observable behaviors, outputs, forbidden changes,
and limitations — never “works,” “looks good,” or “tests green.”

### 3.1 First coding contract (gate table)

Request coverage (criterion-to-check/evidence matrix); scope preservation (baseline/candidate/
applied diff + effect manifest); no destructive surprise (structural diff/preservation
predicates); reachability (feature callable from its entry point — integration/route/command
test); build (actual command, platform, exit + output evidence); type/lint/format (strict,
frozen configs); tests (discovery/execution/outcome records, not summary text); generated
contracts (deterministic generation/drift evidence); dependencies (approved proposal +
audit/license results); security/privacy (mandatory targeted negative tests + policy checks);
native boundary (real native evidence per required platform — mocked browser IPC never
satisfies native claims); delivery (candidate/output references + mode settlement). Every gate
is conditional on the frozen plan, never an optional shortcut; a missing native environment
blocks or narrows the contract, never waives the criterion.

### 3.2 Diff, preservation, and outcome interpretation

Baseline separates pre-existing user changes from agent effects — never stage/reset/delete
user work as verification convenience; review the effect manifest and final content, not just
the proposed patch. Flag: unexplained removal/large replacement; test deletion, skip/only
markers, reduced assertions/discovery; weakened compiler/lint/audit/coverage settings;
capability/CSP/permission expansion; mocked stubs swapped for required real integrations;
unreachable routes, disconnected controls, placeholder success messages; out-of-scope
dependency/config/lockfile changes; hardcoded fixtures; executable/ACL/link changes;
overwritten user edits; stale-target application. Legitimate deletions/refactors pass only
when requested/approved with preservation/behavior evidence; agent-weakened mandatory tests
cannot self-certify — retain regression intent and version the new `CheckDefinition`.

Outcome rules: exit zero is necessary only where the contract says so and never sufficient
for coverage/integrity; zero discovered tests fails a required test check short of a proven
applicability rule; track expected suites/critical cases/skips — fewer tests than expected
needs review; watch mode, interactive prompts, silent background children, timeouts, and
missing final reports cannot satisfy bounded checks; capture the actual approved invocation
(printed commands prove nothing); preserve stdout alongside outer process evidence; rerun
affected checks after every code/config change (“passed before the last fix” is stale).

### 3.3 Flakiness, reviews, warnings, remediation

Failed mandatory executions stay recorded even when a later run passes — never keep only the
green attempt; default automated reruns are zero unless the `CheckDefinition` authorizes a
bounded diagnostic rerun on the same candidate/environment within budget. Known-flaky checks
need a reviewed policy (repetitions, acceptance rule, prior evidence, owner, expiry); an
undeclared fail-then-pass stays a finding; “it is flaky” from the model proves nothing;
quarantining a mandatory test needs a new authorized contract decision, never an inline skip.
Advisory model review finds gaps but authenticates nothing, approves nothing, overrides
nothing — two-model agreement is not independent proof. Human review satisfies only
judgment-defined criteria with recorded candidate/criterion/decision/rationale, and cannot
forge unrun builds or override hard safeguards. No confidence threshold converts blocked
evidence into pass.

Warnings are predeclared optional/advisory findings with owner/impact/evidence/candidate/
follow-up; waivers cover only waiver-eligible obligations with approver/check/reason/scope/
expiry/revision — a waiver is not a pass and stays visible. Never waive isolation, sandbox
enforcement, credential privacy, evidence integrity, settled effects, or mandatory criteria
into completed-with-warnings; “finish anyway” gets a blocked/partial handoff or a narrower
prospective contract, with original failure history preserved.

Bounded remediation (default zero cycles, matching P0-07): reviewed contracts may define a
finite count with budgets, change scope, and approval rules. Each cycle records findings,
obtains authority, mints a new candidate with provenance, applies allowed changes through
P0-09, invalidates affected evidence, and runs a fresh verification under the unchanged
contract. Budgets never reset; retries count within the same ceilings; no infinite
self-repair loops; scope/permission/dependency/test expansion needs explicit review.
Exhaustion or proven mandatory failure terminalizes `failed-verification` after settling
effects; missing authority/environment/evidence holds blocked.

### 3.4 Durable lifecycle, recovery, handoff, privacy

Verification lifecycle: `planned → running → settled(pass | pass-with-permitted-warnings |
fail | blocked | canceled)`; new candidates mint new runs, never mutate settled verdicts.
Completion sequence: proposal → settle operations/intent → freeze candidate/contract/plan →
execute checks + capture → validate provenance/applicability/coverage/hard gates →
deterministic verdict → compare run/candidate/contract revision + epoch → atomic
`CompletionDetermination` + runtime closure + projection + receipt → content-free
notification. Verification IO never runs inside the SQLite commit; filesystem checks bind
observed manifests to broker action revisions with final revalidation on drift; post-commit
changes mark applicability stale without rewriting history; exactly one terminal determination
per run via revision/unique constraints and idempotent commands.

Crash recovery: fence epochs, verify storage, rebuild projections effect-free, reconcile
sandbox checks under P0-09, mark incomplete captures canceled/blocked/unknown (never passed),
re-run only explicitly permitted safe checks within budget (default: hold for user),
recompute from settled evidence, never double-terminalize or repeat applied effects.
Corrupted/missing mandatory evidence blocks new decisions; history stays immutable with
degraded-accessibility marking; never fabricate replacements.

Handoff (generated from the trusted projection, model wording constrained to supported
claims): verdict + delivery mode + candidate/revision + environment + coverage; commands run
with platform/profile + evidence refs; skipped/blocked/stale/failed lists; preserved scope +
side effects/uncertainty; warning/waiver provenance; untested platforms/behaviors +
limitations; next permitted action. “All tests pass,” “native integration verified,” “no data
left the device,” “safe to release” each need their explicit criterion and evidence.

Privacy: stdout/stderr, diffs, screenshots, fixtures, command/env details, and manifests live
in protected artifacts under original scope; structural records carry references, codes,
counts, versions. Screenshots and logs can leak sensitive data — never auto-upload to
telemetry/support or cloud reviewers; exports need explicit selection + privacy review +
scoped authorization with a redaction manifest. No provider keys, vault material, raw host
paths, or environment dumps captured; machine details stay protected with safe platform
summaries by default. Retention/deletion may drop protected content while keeping structural
facts; never promise reproducibility after erasure.

### 3.5 Events, commands, IPC amendment

Reviewed P0-02 families: `verification/started`, `verification/check-recorded`,
`verification/completed`, `task/completion-determined` — runtime closure and completion
determination commit together under P0-07 rules, never as competing terminal authorities.
Further contract/candidate/amendment/invalidation/remediation/waiver facts need versioned
schemas + registry review. Projections: criterion coverage, current results, applicability,
findings/warnings, history, handoff. Proposed commands: `RequestVerification`,
`GetVerificationState`, `GetEvidencePage`, `ResolveHumanReview`, `AmendCompletionContract`,
`RequestBoundedRemediation` — none permitted until P0-04 DTOs, limits, capabilities,
bindings, error mappings, and tests are amended. Forbidden: `SetCompleted`, `ForcePass`,
`DeleteFailure`, generic verifier-script endpoints. Notifications carry scope/revision
invalidation only; evidence arrives through authorized bounded queries.

## 4. Eval-harness controls

P0-10 gates single completions; this section keeps the gate itself honest over time. Every
harness below is design input — never a dependency, never imported code.

1. **Task/solver/scorer separation (Inspect AI pattern).** Evals compose a dataset of samples,
   a solver (the agent loop, sandboxed — Docker in the reference approval demo), and scorers
   with metrics, plus epochs for repeats and interim scoring of in-flight samples. Adham
   equivalent: `VerificationPlan` (dataset) + `CheckDefinition` (solver step) + verdict rules
   (scorer) + `VerificationRun` per candidate revision (epoch). Solver and scorer stay
   different principals — the producer never grades itself.
2. **Trajectory + component metrics (DeepEval pattern).** Score the whole ordered trace
   (task completion, step efficiency, plan quality/adherence) and the individual decisions
   (tool choice, argument correctness) against goldens with expected tools. `GEval`-style
   criteria carry explicit thresholds (e.g. 0.7) and run as test assertions. Adham equivalent:
   step/attempt outcome records feed progress guards (P0-07) while verdict rules consume only
   settled applicable evidence.
3. **Registry discipline (OpenAI evals pattern).** Named evals with registered completion
   functions, versioned YAML, review-before-merge for new evals. Adham equivalent: versioned
   `CheckDefinition`s, pinned toolchain revisions, drift-checked generated bindings, no custom
   code smuggled into evals without review.
4. **Contamination guards.** Web-scale training absorbs test data: 11.7–31.6% verbatim match on
   SWE-bench Verified, 76% file-path accuracy from issue text alone, 60–76% ticket-only
   accuracy. Controls: fresh/held-out task sets (SWE-rebench, SWE-bench Pro over retired
   Verified — OpenAI: 59.4% of unsolved Verified problems materially flawed), translation and
   paraphrase variants, verbatim-match probing, four-tier contamination taxonomy
   (exact/syntactic/semantic/task-level). Adham rule: provider/model selection for judging or
   probing must assume training exposure; refresher tasks invalidate stale green evidence.
5. **Reward-hack resistance.** 28.5% of sampled Verified tasks accept Docker-verified wrong
   patches; Berkeley broke 8 agent benchmarks via 45 isolation exploits; SpecBench's 65pp
   validation-vs-held-out gap; 2,900-line hash-table “compilers” memorizing inputs. Controls:
   held-out suites distinct from validation suites, mutation-strengthened tests (SWE-ABS
   rejects 19.7% of suite survivors), isolation audits, process-aware review of how success
   was reached — not just the final patch. Adham rule: §3.2 preservation indicators +
   never-trust-stdout + independent acceptance predicates.
6. **Judge-bias controls.** LLM judges show position bias (up to 0.192, 72% first-position
   majorities), style bias (0.76–0.92 for markdown), self-preference, verbosity effects, and —
   worst — agreeableness bias (TPR >96% but TNR <25%: judges confirm correct outputs yet
   cannot reject invalid ones), with 13.6% average pairwise flip rates and a
   consistency-bias paradox (test-retest 0.99 alongside severe bias). Mitigations: AB+BA
   position swaps, rubrics, chain-of-thought, ensembles with bias regression, format-validated
   outputs (~10% unlabeled from malformed JSON). Adham rule: advisory model review only (§3.3)
   — judges inform, verifiers decide, and mandatory gates never rest on a judge's word.
7. **Environment-noise accounting.** Anthropic: Terminal-Bench 2.0 scores swing 6pp on infra
   alone (pod errors 6% → 2.1% with 3× resources); scaffold choice moves accuracy 5.7pp while
   multiplying tokens 65×; 31% of TB 2.0 tasks defective (superseded by 2.1, ranks stable
   ρ=0.958); OSWorld's real-OS + pixel-action design as the trustworthier grading shape;
   τ-bench Pass^k for consistency-sensitive agents. Adham rules: per-task resource specs
   enforced consistently, fixed sandbox profiles recorded in evidence provenance, harness
   version pinned in cache keys, efficiency tracked beside accuracy, programmatic state checks
   preferred over LLM-graded outputs.
8. **Regression discipline.** Every gate in §3.1 becomes a standing suite: verdict truth
   tables, authority probes (model/renderer cannot pass/amend/terminalize), scope/freshness/
   provenance attacks, test-integrity mutations, preservation traps, flakiness histories,
   warning/waiver boundary attempts, remediation exhaustion, effect/race/durability faults,
   recovery replays, canary privacy sweeps, native-claim abuse, coverage completeness —
   executed on deterministic fakes first, then process-kill integration on temporary
   protected storage with validated native runners.

## 5. Gate skeleton, risk log, sources, and open decisions

### 5.1 Skeleton (names only — no code authorized)

P0-10 §22 tree, gate only:

```
crates/adham-verify/src/
├── lib.rs                    # Public API only (verdict math is pure: typed evidence in, verdict out)
├── domain/                   # contract, criterion, candidate, plan, check, evidence,
│                             # finding, freshness, verdict, waiver
├── application/              # prepare, collect, evaluate, invalidate, remediate, recover
├── ports/                    # persistence, snapshot, executor, artifacts, review
└── tests/                    # truth-table/property/fault/process-kill suites (§4.8)
```

Rules: pure verdict evaluation touches no provider client; effect ports call the reviewed
P0-09 path; snapshot/manifest capture is trusted infrastructure; terminalization stays
outside model review adapters; fakes live in test/dev profiles; always-pass verifiers
forbidden in production; dependencies added only when consumed and reviewed.

Acceptance follows P0-10 G1–G5: contract + pure verdict core (truth-table/property proof that
mandatory gaps never pass) → candidate/evidence capture (manifests, provenance, forged-output
rejection, sandbox-only execution) → first coding contract (preservation, reachability,
quality/tests, generated contracts, proposal-vs-applied distinction, no absent-native pass) →
runtime durability (race/transaction tests, effect-free recovery, reviewed IPC amendments) →
handoff review (accurate pass/fail/block/skip/stale/warning listing, claim-to-criterion
mapping, green security/privacy/audit/fault/native gates, recorded limitations). Stop on:
scope/provenance/integrity failure, missing/stale mandatory checks, unknown effects,
unavailable containment, unexpected candidate change, unreviewed test weakening, or
budget/control blocks — returning truthful blocked/failed/partial handoffs, never
suppression, fabrication, stale reuse, silent waivers, or baseline overwrites.

### 5.2 Risk log (signal → Adham rule)

| # | Signal | Adham rule |
|---|---|---|
| E1 | 28.5% hackable tasks; 45 isolation exploits; 65pp SpecBench gap | §4.5: held-out suites, mutation tests, isolation audits |
| E2 | 59.4% flawed Verified problems; 76% ticket-only accuracy | §4.4: benchmark retirement, fresh sets, contamination probes |
| E3 | Agreeableness TNR <25%; 13.6% flip; consistency-bias paradox | §4.6: judges advisory-only, swaps/rubrics/ensembles |
| E4 | 6pp infra swing; 65× scaffold token gap; 31% defective tasks | §4.7: pinned envs, recorded profiles, programmatic grading |
| E5 | 72 premature completions; reward-hacked suites | §3.1–3.3: evidence-backed gates, flakiness discipline |
| E6 | Ghost-passing: zero tests, truncated reports, forged stdout | §3.2: discovery/execution/outcome records, not summaries |
| E7 | Silent waivers; “finish anyway” pressure | §3.3: waiver boundaries, blocked handoffs, preserved history |
| E8 | Infinite self-repair loops | §3.3: zero default remediation, finite reviewed cycles |
| E9 | Crash-before-capture claimed as success | §3.4: recovery recomputes from settled evidence only |
| E10 | Native claims from mocked browser tests | §3.1: real native evidence per required platform |

### 5.3 Sources

- Context7: `/ukgovernmentbeis/inspect_ai` (Task/solver/scorer/epochs, sandboxed tool demos,
  interim scoring); `/confident-ai/deepeval` (GEval + thresholds, faithfulness/relevancy,
  trajectory vs component agent metrics, goldens); `/openai/evals` (registry, completion
  functions, custom-eval review).
- Live channels (`agent-reach doctor` 4/16 verified earlier: V2EX, RSS, Jina Reader,
  Bilibili-search; GitHub/YouTube/Exa + 9 login channels unavailable).
- Web: OpenAI SWE-bench Verified retirement (59.4%); SWE-Bench Illusion memorization studies
  (76%, 11.7–31.6%); reward-hackability audit (28.5%, R2E-Gym 25%, SWE-ABS 19.7%);
  SpecBench two-way decomposition; GEM contamination review (T1–T4); judge-bias studies
  (position/verbosity/self/style/agreeableness, flips, paradox, mitigations); Anthropic
  infra-noise post (6pp, 3× resources); Terminal-Bench audit (31% defects, 2.1, ρ=0.958);
  scaffold-effect paper (65× tokens, 40× per-solve gap); Turing confident-failure analysis
  (65.4% confident false completion); OSWorld/Tau-bench/benchmarks survey; CHI verification
  load; anti-fake agents catalog; Verification Horizon reward faithfulness; xbio premature
  completion (72); Explyt false-claim checks.
- Repo: `P0-10 — Verification gate and evidence-backed completion contract.md:1-522`
  (invariants, objects, contract creation, delivery modes, check taxonomy, verdict rules,
  provenance, freshness, snapshot observation, coding contract, preservation, outcome
  interpretation, flakiness, reviews, warnings, remediation, lifecycle, recovery, handoff,
  privacy, events/IPC, Rust structure, adversarial tests, gates, stop conditions).

### 5.4 Open decisions (human-gated, unchanged)

Same six: Apache-2.0 license (no placeholder); Node 24 LTS; `ts-rs` for P0 IPC DTOs; manual
Vite + `pnpm tauri init`; domain-command boundary; dependency-set approval before any install.
Plus P0-10's own gates G1–G5 and the rule that P0-11 graph nodes inherit this completion gate
instead of aggregating unverified child claims.

This matrix authorizes nothing: no test execution, installs, reads, publishing, commits, or
patch application.
