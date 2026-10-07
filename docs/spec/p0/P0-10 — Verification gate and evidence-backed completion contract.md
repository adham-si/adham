<aside>
✅

Completion is a trusted determination backed by fresh, scoped evidence—not a model statement, successful tool call, green screenshot, or zero exit code. Mandatory requirements must be satisfied for the exact deliverable being handed off. Missing, stale, unsafe, or contradictory evidence cannot be converted into success by confidence or wording.

</aside>

## Purpose and implementation boundary

Define Adham’s completion contract, verification plan, evidence provenance, check results, freshness/invalidation, scope-preservation rules, verdict calculation, bounded remediation, and durable completion transaction.

Initial implementation targets coding tasks performed through the P0-09 broker and sandbox: verify an immutable proposed patch/snapshot, or verify the actual broker-applied deliverable according to the task’s declared mode. Additional writing/research/action contracts are typed future extensions, not a universal claim that one coding checklist proves all work.

This specification does not authorize executing tests, installing dependencies, reading additional folders, publishing, committing, or applying a patch. Verification actions remain subject to the same policy, approval, sandbox, resource, and privacy requirements as ordinary tools.

### Governing specifications

- P0-07 — Agent runtime state machine.
- P0-08 — Provider gateway and normalized stream contract.
- P0-09 — Tools, policy, and sandbox execution contract.
- P0-06 — Repository scaffold execution and evidence checklist.
- P0-02 — Canonical event taxonomy & schema.
- P0-03 — SQLite event store, content & projections.
- P0-04 — Typed IPC, capabilities & frontend sync.
- P0-05 — Project-isolation threat model.

## 1. Non-negotiable invariants

1. The model can propose completion; only trusted verification/application services determine it.
2. Completion claims bind to a TaskId, RunId, immutable scope, contract revision, candidate deliverable, and evidence set.
3. A mandatory unmet requirement is never a permitted warning.
4. Required skipped/unavailable/unknown/stale checks block completion; they are not pass results.
5. Evidence from another revision, project, account, platform, or capability profile cannot be silently substituted.
6. Replay rebuilds decisions from durable evidence; it never reruns checks or effects automatically.
7. Verifier execution cannot expand filesystem/network/credential authority or bypass sandbox support.
8. Tests and project scripts are untrusted code. Trusted capture proves what ran and was observed, not that the project’s tests are inherently adequate or honest.
9. A model/reviewer’s confident assertion is not machine-verifiable proof.
10. Scope preservation, policy safety, unresolved side effects, and evidence integrity are nonwaivable hard gates.
11. No automatic repair deletes tests, narrows requirements, disables security, or changes the contract to fit the implementation.
12. Terminal runs stay terminal; later artifact changes affect evidence applicability/current projections, not immutable historical facts.
13. The verified deliverable must match the actual handoff mode: proposal, applied changes, or artifact—not an unstated mixture.
14. Every user-facing success claim must map to a satisfied criterion with appropriately limited evidence.

## 2. Domain objects and ownership

| Object | Responsibility |
| --- | --- |
| CompletionContract | Versioned objective, requirements, mandatory checks, delivery mode, permitted warnings, and acceptance authority |
| AcceptanceCriterion | Stable requirement with observable predicate or explicit human-review obligation |
| VerificationPlan | Concrete scoped check definitions, dependencies, environments, and budgets |
| CandidateDeliverable | Frozen patch/snapshot/artifact or observed applied-result manifest being evaluated |
| VerificationRun | One bounded evaluation attempt for one contract/candidate revision |
| CheckDefinition | Reviewed validator/command/review obligation and result semantics |
| CheckExecution | One actual invocation/review linked to trusted provenance and captured output |
| EvidenceRecord | Immutable protected evidence and safe structural metadata |
| Finding | Scoped failed/blocked/warning condition with provenance and severity |
| VerificationVerdict | Trusted deterministic result derived from current applicable check results |
| CompletionDetermination | Atomic runtime terminal decision linked to verdict and deliverable |

Use typed backend IDs: CompletionContractId, CriterionId, VerificationPlanId, VerificationRunId, CheckId, CheckExecutionId, EvidenceId, FindingId, and CandidateId. Preserve runtime OperationId/AttemptId and driver epoch for execution/recovery.

adham-verify owns domain rules and verdict calculation. adham-runtime owns run controls/terminal lifecycle. adham-tools/platform/sandbox own approved effects and capture; protected artifact storage owns evidence bytes. The verifier never receives unrestricted SQL, file, shell, provider, or vault access.

## 3. Completion contract creation and amendments

Create and freeze the contract before substantial task effects. If the user’s request is ambiguous, resolve delivery/scope/required behavior before promising completion. A trusted compiler may derive a draft from the request and reviewed templates; a model-generated draft requires validation and authorized acceptance for consequential requirements.

Required fields:

- objective reference and authorized owner;
- immutable workspace/project/session/task identity;
- delivery mode and permitted target/resource scope;
- baseline/snapshot references and preservation obligations;
- acceptance criteria and check-to-criterion coverage;
- mandatory versus optional requirements;
- supported/required platforms, modalities, and assurance boundaries;
- toolchain/environment/check-definition revisions;
- warning policy and review authority;
- verification/remediation budgets and deadlines;
- contract version/revision and amendment policy.

Criteria cannot be only “works,” “looks good,” or “tests green.” Express observable behaviors, outputs, forbidden changes, and applicable limitations.

### Amendments

An authorized human may deliberately change the task scope. Persist an explicit new contract revision and reason, invalidate incompatible evidence, and verify again. Do not silently mutate the existing contract or retroactively convert its failed result to pass.

A genuine scope reduction produces a narrower deliverable and narrower completion statement. Changes proposed solely to evade failed checks require transparent review; hard security/integrity requirements remain nonwaivable. Terminal runs cannot be reopened under a changed contract: a follow-up uses a new run with provenance.

## 4. Delivery modes and what completion means

| Mode | Required handoff | Completion may claim |
| --- | --- | --- |
| proposal-only | Protected reviewed patch/artifact plus exact tested baseline/candidate manifest | Proposal verified against the recorded candidate; not applied |
| apply-and-verify | Broker-applied files with settled effects and evidence applicable to resulting content | Changes applied and verified as of the recorded observation |
| artifact-only | Exact generated artifact with structural/content validation and review criteria | Artifact produced/validated for the stated purpose |

Default must be explicit; never apply a proposal because tests passed. Staging-only build success does not prove a native installation, live repository state, deployment, or release.

For apply-and-verify, tests may run on an equivalent frozen candidate, but completion also requires broker-observed post-application equivalence and relevant live-state checks. Any changed dependency/config/input affecting equivalence invalidates reuse.

External writers cannot be made atomic with SQLite by an Adham mutex. Record observation boundaries and preconditions honestly: evidence establishes a particular observed content state, not that files will remain unchanged forever. A detected change before verdict commitment blocks/invalidate; a later change marks current applicability stale without rewriting historical completion.

## 5. Check taxonomy and result states

Check kinds:

- deterministic structural/content predicate;
- bounded command/test execution;
- generated-contract/schema drift check;
- diff/scope/preservation check;
- security/policy/effect-reconciliation gate;
- browser-renderer behavior test;
- real native/platform behavior test;
- approved external/CI evidence import;
- authorized human review;
- advisory model review.

Check results:

| State | Meaning |
| --- | --- |
| pending / running | Not yet settled |
| passed | Reviewed success predicate satisfied by applicable evidence |
| failed | Valid applicable evidence contradicts the requirement |
| blocked | Prerequisite, permission, environment, capability, or authoritative evidence unavailable |
| skipped | Explicitly not executed; reason/authority recorded |
| stale | Evidence no longer applies to the candidate/contract/environment |
| invalid | Evidence integrity/provenance/schema cannot be trusted |
| canceled | Check stopped under durable control intent |
| not-applicable | Exclusion predicate in the frozen contract proven true |

not-applicable cannot be freely chosen after failure. Mandatory conditional checks may be not-applicable only when their predeclared applicability predicate is proven. A mandatory applicable skipped check blocks completion.

An expected negative test passes only when the expected rejection AND absence of forbidden effects are observed. Timeout/output truncation/unparseable result is not pass even if a runner printed success earlier.

## 6. Deterministic verdict rules

Evaluate hard gates first, then required criteria, then optional warning obligations. Normalize results deterministically from reviewed CheckDefinitions; the model cannot supply arbitrary verdict weights.

| Conditions | Verification verdict |
| --- | --- |
| Integrity/security/authority failure or unsettled effects | blocked with incident/reconciliation handling |
| Mandatory applicable check validly fails | fail |
| Mandatory evidence missing/running/skipped/stale/invalid/unavailable | blocked |
| Every mandatory criterion satisfied; no relevant warning | pass |
| Every mandatory criterion satisfied; only explicitly permitted optional findings | pass-with-permitted-warnings |

If both failure and blocked evidence exist, retain all findings: do not hide a proven failure behind “environment unavailable.” Record fail plus independent blockers for remediation; security uncertainty still prevents unsafe continuation/terminal success.

Mapping to P0-07:

- pass → completed;
- pass-with-permitted-warnings → completed-with-warnings;
- fail → failed-verification, or a separately authorized bounded remediation cycle;
- blocked → blocked(verification-required or specific reason).

Cancellation wins if its intent committed before terminal completion. No check result can override a pending cancel or revive a terminal run. Pause requested before terminalization holds the run at a safe boundary until explicitly resumed or canceled.

## 7. Evidence provenance and authenticity

EvidenceRecord metadata includes:

- scope, TaskId/RunId, contract/plan/candidate revisions;
- criterion/check/execution IDs and producer type/version;
- observed input and result manifest references;
- tool OperationId/AttemptId, grant, sandbox instance/profile, driver epoch;
- executable identity/version, argv/environment profile references;
- dependency/lockfile/config/toolchain revisions;
- actual OS/architecture/runtime and tested capability;
- start/end time, duration, exit/signal/timeout/resource status;
- captured output artifact references, truncation flags, parser version;
- provenance confidence, import verification, and observation limitations;
- expected versus observed result and safe reason codes.

Raw command arguments, names/paths, outputs, private manifests, content-derived hashes, and screenshots stay protected; structural events use references and bounded non-sensitive metadata.

Trusted capture observes process launch/termination/output and filesystem artifacts through reviewed brokers. Project stdout saying “all passed” is not a signed verdict. A screenshot of green text, a model-created report, or an editable result file is evidence only of those bytes unless independent checks support stronger claims.

Content hashes/checksums detect substitution relative to an established record; they do not authenticate an untrusted producer by themselves. IPC framing/private handles, trusted capture identities, and local authorization protect provenance. Same-user/OS compromise remains a stated residual risk; do not claim cryptographic security against a fully compromised host.

CI/imported evidence requires an approved source, exact revision, workflow/tool definition, platform, artifact integrity/provenance, and applicable permissions. A link to a green unrelated job is not proof. If an import cannot be verified, mark it advisory/invalid for mandatory automated gates.

## 8. Freshness and invalidation

Applicability is content/configuration-based, not a recent timestamp alone.

Candidate manifests bind source files, approved untracked files, relevant manifests/lockfiles, test/check definitions, assets, generated inputs, toolchain/environment, and sandbox profile. A Git commit ID alone is insufficient when the worktree/untracked/generated files differ.

Invalidate affected evidence when:

- candidate content or application result changes;
- contract/criterion/validator/check command changes;
- dependency/lockfile/build/config/environment changes;
- platform/runtime or sandbox assurance changes;
- policy/root/grant restrictions change;
- check output is truncated, tampered, or cannot be decoded;
- required external data/advisory freshness expires;
- another attempt supersedes the deliverable.

Model-supplied claims about unaffected checks are insufficient for reuse. Start with conservative invalidation: candidate-affecting changes invalidate code/build/test evidence. Refine dependency-aware reuse only after an explicit reviewed impact model and tests exist.

Cache/reuse keys include exact scope, candidate/input manifest, contract/CheckDefinition revision, environment/profile, and producer. No cross-project reuse by raw file hash or test name. Historical evidence remains immutable and visible with stale status.

## 9. Verification snapshot and read-only observation

1. Fence the producing driver and settle active operations.
2. Capture a trusted candidate manifest/baseline relation through the filesystem/artifact broker.
3. Freeze approved inputs and external dependencies required by the plan.
4. Run checks in validated P0-09 staging with source inputs read-only where supported, separate scratch/output, no ambient secrets/network.
5. Capture pre/post manifests and attributable effects through the trusted boundary.
6. Reject or account for unexpected input modification; never certify a candidate changed under test without a new manifest/reverification.
7. Bind results to the exact tested candidate and observation boundary.

Tests can generate artifacts, but may not modify the sealed source/check baseline or verifier control files. If a toolchain requires generated source, declare that phase and its inputs/outputs before checks and freeze the resulting candidate.

Verification does not grant package installation. Missing provisioned dependencies or unsupported sandbox/network requirements block the check. Do not run on the unsandboxed host merely to obtain a green result.

A trusted outer harness captures process status and manifests independently of project-controlled output. Acceptance-critical behavior tests/fixtures should be reviewed, versioned, and protected from modification by the producing agent during verification. A dishonest/ineffective project test can still exit zero; report coverage limits and add independent acceptance predicates rather than promising proof of all program behavior.

## 10. First coding completion contract

Initial template: implement one bounded feature or fix in an existing approved project, preserving unrelated work.

The exact plan is selected from reviewed project instructions/manifests and the task’s acceptance requirements. Do not force nonexistent commands or invent generic scripts that mask the actual repository’s rules.

| Gate | Default requirement | Evidence needed |
| --- | --- | --- |
| Request coverage | Every acceptance criterion mapped to behavior/output | Criterion-to-check/evidence matrix |
| Scope preservation | Changes confined to approved targets and effects | Baseline/candidate/applied diff and effect manifest |
| No destructive surprise | No unexplained deletion, disabling, or behavior loss | Structural diff/preservation predicates |
| Reachability | Feature callable from the intended entry point | Behavioral integration/route/command test |
| Build | Required selected targets compile | Actual command, platform, exit and output evidence |
| Type/lint/format | Applicable repository quality checks pass | Strict checks using frozen configurations |
| Tests | Required unit/integration/regression/acceptance tests pass | Discovery/execution/outcome records, not just summary text |
| Generated contracts | Required bindings/routes/schemas current | Deterministic generation/drift evidence |
| Dependencies | Additions/features/lockfiles approved and audited | Approved proposal and applicable audit/license results |
| Security/privacy | Scope, IPC, redaction and containment unchanged or explicitly accepted | Mandatory targeted negative tests and policy checks |
| Native boundary | Real native behavior when the task concerns Tauri/OS integration | Native evidence for each required platform |
| Delivery | Exact requested proposal/applied/artifact handed off | Candidate/output references and mode-specific settlement |

Examples of behavioral criteria: a typed submit command persists exactly one message; wrong-project input writes nothing; restart restores the same IDs; Arabic layout remains navigable by keyboard; a new UI control invokes the intended application service rather than a placeholder.

All listed gates are conditional on the frozen task plan, not optional shortcuts. An absent native environment cannot waive a required native criterion; it produces a blocked result or an explicitly narrower new contract.

## 11. Diff and preservation rules

Baseline distinguishes pre-existing user changes from agent-produced effects. Preserve untracked/uncommitted work; do not stage/reset/delete it as a verification convenience.

Review actual effect manifest and final content—not only the model’s proposed patch. Detect:

- unexplained file removal/large replacement;
- test deletion, skip/only markers, reduced assertions or discovery;
- weakened compiler/lint/audit/coverage settings;
- security capability/CSP/permission expansion;
- fake/mocked implementation substituted for required real integration;
- unreachable routes, disconnected controls, placeholder success messages;
- dependency/config/script/lockfile changes outside approved scope;
- hardcoded fixture responses or empty stubs;
- unexpected executable/ACL/link changes;
- overwritten user edits or stale-target application.

These indicators require context and review; a legitimate deletion/refactor is allowed only when requested/approved and supported by preservation/behavior evidence. Heuristics are findings, not absolute semantic proof. An unexplained warning cannot silently disappear because the model labels it a refactor.

Changes to check definitions or acceptance tests must be separately reviewed; the agent cannot both weaken a mandatory test and use its new green result as sole evidence. Where tests genuinely must change, retain regression intent and version the new CheckDefinition explicitly.

## 12. Command/test outcome interpretation

A CheckDefinition specifies approved executable/argv, environment, discovery expectations, expected exits, result parser, required artifacts/postconditions, and limits.

- Exit zero is necessary only where the contract says so; it is not sufficient for test coverage or result integrity.
- Zero discovered tests fails a required test check unless a predeclared applicability rule proves it irrelevant.
- Track expected suites/critical cases and skips; fewer tests than expected needs explanation/review.
- Watch mode, interactive prompts, silent background children, timeout, or missing final report cannot satisfy a bounded check.
- Capture the actual approved invocation; printed commands are not proof they ran.
- Invalid/contradictory results block or fail according to the observed predicate; preserve both stdout and outer process evidence.
- Nonzero outcomes expected by a negative test pass only with the matching safe behavior/no-forbidden-effect evidence.
- After a code/config change, rerun affected checks. “Passed before the last fix” is stale evidence.
- Audit service unavailable or dependency database stale beyond its approved policy is missing evidence, not a clean scan.

No universal fixed test-count threshold is imposed; specify acceptance-critical suites/cases and repository baseline expectations. Coverage percentage may be optional evidence but cannot substitute for the requested behavior test.

## 13. Flaky tests and rerun discipline

A failed mandatory execution remains recorded even if a later run passes. Do not choose only the green attempt.

Default automated verification reruns: zero unless the CheckDefinition authorizes a bounded diagnostic rerun. Permitted reruns are distinguished from remediation, use the same candidate/environment, and consume the run budget.

Known flaky checks require a reviewed policy describing repetitions, acceptance rule, prior failure evidence, ownership, and expiry. An undeclared fail-then-pass remains a finding; it does not automatically clear mandatory reliability requirements.

Environmental transient failure may produce blocked with evidence rather than code failure. Diagnosis must establish the category; a model assertion that “it is flaky” is insufficient. Quarantining a mandatory test requires a new authorized contract/test-policy decision, not an inline skip by the producing agent.

## 14. Review agents, human acceptance, and confidence

Advisory model review may identify missing requirements, risky diffs, or unsupported claims. It operates on scoped context under P0-08 privacy/budget policy and returns findings with evidence references.

A review agent cannot authenticate command execution, approve capabilities, override mandatory checks, or certify absence of defects. Agreement between two models is not independent proof. Report model review as advisory unless a task explicitly requires that review step; even then completion is “review performed,” not mathematical correctness.

Human review may satisfy criteria defined as judgment/acceptance when the reviewer is authorized and records the exact candidate, criterion, decision, and bounded rationale. It cannot forge an unrun build/security test or override hard safeguards.

No numeric model-confidence threshold turns blocked evidence into pass. Assurance labels describe tested scope and limitations, not certainty that all future behavior is safe.

## 15. Warnings, waivers, and explicit scope reduction

Permitted warnings are predeclared optional/advisory findings: for example a noncritical style suggestion or an optional platform not included in the required matrix. Each warning records owner, impact, evidence, applicable candidate, and any follow-up.

Waivers are restricted to explicitly waiver-eligible optional/advisory obligations. Record authorized approver, exact check/finding, reason, scope, expiry, and contract revision. A waiver is not a passed check and stays visible.

Never waive identity/scope isolation, sandbox enforcement, credential privacy, event/evidence integrity, settled side effects, or a mandatory criterion into completed-with-warnings. An authorized human may instead accept a genuinely narrower task contract prospectively; verify that new revision and state exactly what is no longer claimed.

User requests to “finish anyway” do not grant unsafe effects or allow false success. Offer a blocked/partial handoff with the missing evidence, or an explicit contract scope decision. Preserve the original failed/blocked verification history.

## 16. Bounded remediation

Default automatic remediation cycles: zero, matching P0-07. If enabled by a reviewed contract, define an exact finite count, remaining resource/time/token/cost budget, allowed change scope, and approval rules before starting.

A remediation cycle:

1. Records failed findings and applicable evidence.
2. Obtains required change/action authority.
3. Creates a new candidate and provenance link.
4. Applies only allowed changes through P0-09.
5. Invalidates affected evidence.
6. Executes a fresh verification run under the unchanged contract, unless an authorized amendment exists.

Budgets do not reset. Additional model/provider/tool retries count independently within the same ceilings. No infinite self-repair/reviewer loop. Newly expanded scope, permissions, dependencies, or tests requires explicit review.

On exhausted remediation or a proven mandatory failure with no permitted cycle, terminalize failed-verification after settling effects. On missing authority/environment/evidence, remain blocked with a safe handoff. No automatic rollback overwrites user changes.

## 17. Durable verification and completion lifecycle

Verification lifecycle:

planned → running → settled(pass / pass-with-permitted-warnings / fail / blocked / canceled)

A changed candidate creates a new VerificationRun; it does not mutate an old settled verdict. Check executions and evidence remain immutable. Applicability projections can mark old evidence stale.

Completion sequence:

```
CompletionProposal
→ settle active operations and control intent
→ freeze candidate/contract/plan
→ execute approved checks and capture evidence
→ validate provenance, applicability, coverage, hard gates
→ deterministic verdict
→ compare current run/candidate/contract revision and driver epoch
→ atomic CompletionDetermination + runtime closure + projection + receipt
→ publish content-free notification
```

The final transaction validates that no earlier cancellation, pause hold, contract change, or unresolved operation prevents success. It references durable settled evidence; verification IO never occurs inside the SQLite commit transaction.

Filesystem checks cannot be atomically joined to SQLite. Bind observed result manifests and broker action revision, perform final revalidation where applicable, and fail on detected drift. Do not claim global instantaneous consistency with external writers. Post-commit changes create a current applicability finding, not a rewrite of the historical terminal event.

Exactly one terminal completion determination per run is enforced through expected revision/unique constraints and idempotent commands. A lost response followed by the same RequestId returns the original result. Different payload/scope conflicts.

## 18. Recovery and uncertainty

On crash during verification:

1. Fence old epochs and verify canonical/evidence storage.
2. Rebuild check/verdict projections without executing effects.
3. Reconcile active sandbox checks and process trees under P0-09.
4. Mark incomplete captured results canceled/blocked/unknown rather than passed.
5. Validate candidate/contract/evidence applicability.
6. Resume only explicitly permitted safe checks within remaining budgets; default recovery holds for user resolution.
7. Recompute a verdict from settled applicable evidence.
8. If completion already committed, return it; never run a second terminalization or repeat applied effects.

A crash after test completion but before capture/result commit may require rerun if authoritative outcome cannot be recovered. It is not evidence of success. Rerun remains sandboxed/budgeted and must not blindly repeat side-effecting checks. A process termination report alone does not settle external effects.

Corrupted/deleted/unavailable mandatory evidence blocks a new completion decision. A historical determination remains an immutable fact but current evidence accessibility/assurance is marked degraded; do not fabricate replacement evidence.

## 19. User-facing evidence handoff

Show a concise verdict with delivery mode, exact candidate/revision, tested environment, and requirement coverage. Do not show “Done” merely because generation or tool execution stopped.

Required handoff:

- what was produced/applied and where the authorized artifact is available;
- mandatory criteria and their check outcomes;
- commands actually executed, platform/profile, and evidence references;
- tests/checks skipped, blocked, stale, or failed;
- preserved scope and any actual side effects/uncertainty;
- warning/waiver details and approval provenance;
- untested platforms/behaviors and evidence limitations;
- next permitted action for blocked/failure states.

Statements such as “all tests pass,” “native integration verified,” “no data left the device,” or “safe to release” require corresponding explicit criteria/evidence. Browser-mocked IPC cannot support native integration claims. A build is not a release-security/signing/deployment certification.

Generate the handoff from the trusted evidence projection, with optional model wording constrained to supported claims. Validate that every success statement maps to a passed criterion; if generation invents stronger claims, replace it with deterministic safe wording.

## 20. Evidence privacy, retention, and export

Store stdout/stderr, diffs, screenshots, fixture content, command/env details, and content-derived manifests in protected artifacts under original scope. Structural records contain references, safe result codes/counts, and versions.

Apply the same redaction/canary tests as P0-09. Screenshots and test logs can contain sensitive project/user data even when commands are harmless. Do not automatically upload them to telemetry/support or send them to a cloud reviewer.

Exports require explicit selection, privacy review, and scoped authorization. An export manifest states redaction and missing evidence limitations. Retention/deletion policy can remove protected content while preserving permitted structural facts; do not promise indefinite reproducibility after evidence deletion or forensic erasure from all backups.

No provider keys, vault material, raw host paths, or unrestricted environment dumps are captured. Where machine details are required, protect them and expose only safe platform summaries by default.

## 21. Events, projections, and IPC amendment

Use reviewed P0-02 families:

- verification/started;
- verification/check-recorded;
- verification/completed;
- task/completion-determined.

Additional proposed contract/candidate/amendment/invalidation/remediation/waiver facts require versioned schemas and registry review. Events reference protected manifests and evidence rather than duplicating private bytes. Avoid a second competing task-terminal authority: runtime closure and completion determination commit together under P0-07 rules.

Projections include criterion coverage, current check results, evidence applicability, findings/warnings, verification history, and completion handoff. Unknown future event/check/verdict schema versions block affected completion semantics safely.

Proposed application commands: RequestVerification, GetVerificationState, GetEvidencePage, ResolveHumanReview, AmendCompletionContract, and RequestBoundedRemediation. Amendments and reviews require explicit authority. These are not permitted Tauri commands until P0-04 DTOs, limits, capabilities, generated bindings, error mappings, and tests are amended.

No SetCompleted, ForcePass, DeleteFailure, or generic verifier script endpoint is exposed. Notifications carry scope/revision invalidation only; private evidence is fetched through authorized bounded queries.

## 22. Rust structure and verifier ports

```
crates/adham-verify/src/
├── lib.rs
├── domain/
│   ├── contract.rs
│   ├── criterion.rs
│   ├── candidate.rs
│   ├── plan.rs
│   ├── check.rs
│   ├── evidence.rs
│   ├── finding.rs
│   ├── freshness.rs
│   ├── verdict.rs
│   └── waiver.rs
├── application/
│   ├── prepare.rs
│   ├── collect.rs
│   ├── evaluate.rs
│   ├── invalidate.rs
│   ├── remediate.rs
│   └── recover.rs
├── ports/
│   ├── persistence.rs
│   ├── snapshot.rs
│   ├── executor.rs
│   ├── artifacts.rs
│   └── review.rs
└── tests/
```

Pure verdict evaluation depends on typed evidence/check results, not a provider client. Effect ports call the reviewed P0-09 path; snapshot/manifest capture is trusted infrastructure. Runtime terminalization remains outside a model review adapter.

Fakes belong in test/development profiles. An always-pass verifier is forbidden in production. Add dependencies only when consumed and reviewed under P0-06. Respect production source target under 300 lines, review above 400, and documented exceptions above 600.

## 23. Required adversarial and reliability tests

| Area | Required cases |
| --- | --- |
| Verdict truth table | Mandatory pass/fail/missing/skipped/stale/invalid; optional warnings; declared not-applicable predicate |
| Authority | Model/renderer cannot pass checks, amend locked requirements, or terminalize directly |
| Scope | Wrong project/run/candidate/platform evidence rejected; cross-project cache blocked |
| Freshness | Last-minute source/config/lockfile/test/profile change invalidates; commit ID with dirty worktree insufficient |
| Provenance | Forged stdout/report/screenshot; invalid producer/import; artifact substitution; hash alone not authenticity |
| Test integrity | Zero tests; only/skip/removed assertions; changed parser; hidden background child; truncated report; exit zero with missing behavior |
| Preservation | Unexpected deletion, security weakening, stub/mocked replacement, unreachable feature, user-edit overwrite |
| Flakiness | Fail-then-pass history retained; unapproved rerun cannot erase failure; budget exhausted |
| Warnings/waivers | Mandatory failure cannot become warning; hard safeguard nonwaivable; explicit new contract revision reverified |
| Remediation | Finite cycles; no budget reset; unchanged contract; scope expansion requires approval |
| Effects | Staging evidence vs applied result; partial patch/unknown process effects block; cancellation not rollback |
| Races | Completion vs cancel/pause; candidate/contract amendment vs verdict; stale epoch/result rejected |
| Durability | Fault before/after evidence/verdict/terminal commit; duplicate request; exactly one local determination |
| Recovery | Replay performs zero checks/effects; active checks reconciled; missing final capture cannot pass |
| Privacy | Canary absent from events/logs/notifications/public handoff; authorized bounded evidence retrieval |
| Native claims | Mocked browser tests cannot satisfy native requirement; untested platforms not marked validated |
| Coverage | Every mandatory criterion has applicable evidence; confident prose/reviewer approval cannot substitute |

Property tests generate check-result combinations and command traces to prove no false-pass transition under missing mandatory evidence, terminal reopening, or invalid epoch. Process-kill tests use temporary protected storage and validated native runners; a fake capture service does not prove real provenance or sandbox controls.

## 24. Implementation and acceptance gates

### G1 — Contract and pure verdict core

- [ ]  Typed contract/criteria/results and exact verdict rules reviewed.
- [ ]  Warning/waiver/amendment boundaries accepted.
- [ ]  Truth-table/property tests demonstrate mandatory gaps never pass.

### G2 — Candidate and evidence capture

- [ ]  Trusted manifests, producer identities, scope, applicability, and privacy rules implemented.
- [ ]  Forged project output and stale/dirty revisions fail mandatory evidence validation.
- [ ]  Check execution uses approved P0-09 sandbox/tool paths only.

### G3 — First coding contract

- [ ]  Baseline preservation, behavior reachability, quality/tests, generated contracts, and actual delivery coverage implemented.
- [ ]  Proposal-only and apply-and-verify outcomes are distinct and tested.
- [ ]  No absent/unsupported native check is represented as a pass.

### G4 — Runtime durability

- [ ]  Verdict/terminalization race and transaction tests pass.
- [ ]  Recovery produces no repeated effects or fabricated evidence.
- [ ]  Required schema/IPC/capability amendments reviewed and generated artifacts committed.

### G5 — Handoff and evidence review

- [ ]  Trusted handoff accurately lists passed, failed, blocked, skipped, stale, and permitted warnings.
- [ ]  Every completion claim maps to a satisfied criterion for the tested candidate.
- [ ]  Security/privacy, audits, boundaries, fault tests, and native profile gates remain green.
- [ ]  Tested revision/platform/assurance and all residual limitations recorded.

Completion of P0-10 means the verification gate behaves correctly for the validated initial contract—not that every future task is automatically verifiable or every produced program is defect-free.

## 25. Stop conditions and next artifact

Stop completion determination and preserve evidence when scope/provenance/integrity fails, mandatory checks are missing/stale, actual effects remain unknown, containment is unavailable, the candidate changes unexpectedly, a test is weakened without review, or budget/control intent prevents further work.

Do not suppress failures, fabricate output, reuse stale green evidence, mark a skipped test passed, weaken the completion contract implicitly, or overwrite user work to restore a convenient baseline. Return a truthful blocked/failed/partial handoff with the minimal safe next decision.

The next specification is **P0-11 — Task graph and isolated subagent execution contract**: trusted graph transitions, dependency scheduling, leases, delegation/context/capability budgets, child sessions, structured reports, cancellation/recovery, and verification-aware joins. Graph nodes and manager agents must inherit this completion gate; they cannot aggregate unverified child claims into success.