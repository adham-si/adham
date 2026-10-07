<aside>
🛡️

A model requests an action; it never authorizes one. Adham normalizes the proposal, evaluates policy, obtains any required exact-scope approval, creates a constrained execution grant, and verifies the observed outcome. A working directory, command allowlist, or separate process alone is not a sandbox.

</aside>

## Purpose and implementation boundary

Specify the first governed tool path: tool metadata and proposals, policy/approval semantics, capability grants, scheduling, filesystem brokering, patch application, sandboxed process execution, bounded result artifacts, cancellation, and uncertain-side-effect recovery.

This is a design contract—not authorization to execute commands, grant folders, install sandbox software, alter host security, access credentials, or publish changes.

### First tool set

1. **project.read_text** — bounded brokered read of an approved project-relative file.
2. **project.propose_patch** — create a protected patch artifact without changing project files.
3. **project.apply_patch** — apply an approved patch through the trusted filesystem broker with identity/content preconditions.
4. **project.run_process** — execute a reviewed executable/argument vector inside a validated sandbox, initially offline against an isolated project snapshot.

External messages, purchases, publishing, Git push, deletion/rename tools, package installation, network-enabled commands, browser/desktop control, MCP tools, plugins, and delegated subagent execution are excluded. They require later action-specific contracts.

### Governing specifications

- P0-07 — Agent runtime state machine.
- P0-08 — Provider gateway and normalized stream contract.
- P0-05 — Project-isolation threat model.
- P0-03 — SQLite event store, content & projections.
- P0-04 — Typed IPC, capabilities & frontend sync.
- P0-06 — Repository scaffold execution and evidence checklist.
- Architecture — Global and project file paths.

Later storage/path corrections govern implementation: the trusted platform/Tauri resolver owns actual app-data paths. Earlier example paths are not permission to hardcode OS locations in domain crates.

## 1. Security baseline and platform evidence

Windows AppContainer is a platform isolation mechanism for filesystem/registry, network, process, and related resources. Its actual capabilities/ACLs must be configured and tested for Adham’s selected profile; it is not an automatic exact-host egress policy.[[1]](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)

Windows Job Objects support grouped process management, resource accounting/limits, and termination, including kill-on-job-close behavior. Security restrictions must be configured separately; breakaway behavior can undermine descendant containment. Job membership is therefore required lifecycle evidence, not proof of filesystem/network isolation.[[2]](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)

Linux Landlock capabilities vary by kernel ABI, and its documented limitations include inherited descriptors and some special filesystem objects. Network rules are protocol/port-based rather than an arbitrary destination identity policy. Adham must detect effective support and combine controls as necessary; it must not silently omit protections for older kernels.[[3]](https://docs.kernel.org/userspace-api/landlock.html)

OpenShell is a useful defense-in-depth reference for filesystem, network, process, and brokered provider credentials. It is not selected here as a dependency or assumed available on every Adham desktop platform.[[4]](https://docs.nvidia.com/openshell/about/overview)

## 2. Non-negotiable invariants

1. Immutable execution identity follows every proposal, policy decision, grant, call, artifact, result, and recovery action.
2. The renderer, model, project instructions, skill, plugin, and tool output are untrusted.
3. Project roots are opaque, validated capabilities backed by filesystem identity/open handles—not user-supplied absolute strings.
4. Capability and policy authorization precede execution; the executor cannot approve itself.
5. Human approval cannot override hard application invariants, administrator locks, or unavailable containment.
6. Side effects never become exactly-once merely because a database receipt exists.
7. No shell string is implicitly interpolated or executed.
8. Process tools never inherit the entire host environment, credentials, user home, Adham database, or unrestricted disk/network access.
9. Unknown tool names/schema versions, malformed arguments, changed targets, stale grants, and ambiguous outcomes fail closed.
10. Tool success means the tool’s postcondition was observed—not that the task is complete. P0-10 owns task verification.
11. Cancellation stops/reconciles work; it does not imply rollback of already committed filesystem or remote effects.
12. Replaying events or rebuilding projections executes no tool.
13. Logs/events/notifications contain structural facts and protected references, not raw arguments, paths, patches, stdout/stderr, or secrets.
14. A failed security gate is blocked, not a lower-assurance success.

## 3. Objects and trust boundaries

| Object | Meaning |
| --- | --- |
| ToolDefinition | Versioned schema and behavior metadata owned by a reviewed implementation |
| ToolProposal | Untrusted model/human request awaiting normalization and policy |
| NormalizedAction | Trusted canonical action, immutable after approval |
| PolicyDecision | Versioned allow/ask/deny/block result with safe explanation and rule provenance |
| ApprovalRequest | Exact action or explicit bounded rule expansion awaiting an authorized human |
| ExecutionGrant | Short-lived backend-owned capability bound to action, scope, resources, and expiry |
| ToolCall | Durable logical operation with stable OperationId and distinct attempts |
| RootGrant | Project-bound open-root capability and current identity/access constraints |
| SandboxProfile | Required enforcement guarantees and verified platform implementation |
| ToolResult | Observed output/postconditions, effect certainty, and protected artifact references |
| ReconciliationRecord | Trusted evidence resolving a potentially committed side effect |

Trust path:

```
model proposal
→ reviewed tool schema
→ trusted normalizer
→ policy and exact approval
→ scoped grant
→ scheduler and durable dispatch intent
→ filesystem broker or isolated sandbox runner
→ bounded observation and postcondition check
→ durable result
→ runtime observation and later verification
```

The trusted core retains policy/keys/storage authority. The sandbox runner is a separate process but untrusted executable code runs as a further constrained child. A compromised child cannot speak as the policy broker or gain the runner’s authority.

## 4. Tool registry and behavior metadata

Every ToolDefinition records:

- stable tool name, implementation/schema version, owner, and supported platforms;
- reviewed input/output schema with bounds and unknown-field behavior;
- semantic operation class and required capabilities;
- read-only, artifact-only, brokered mutation, or arbitrary-code classification;
- parallel/exclusive scheduling class and resource-lock footprint;
- retry/idempotency/reconciliation support;
- required sandbox/credential/network profile;
- deadlines/resource limits and output-retention policy;
- postcondition evidence and known rollback/compensation limits.

Classification is reviewed metadata, not a model assertion. A command named test/lint/build or run with --check can still execute project scripts and arbitrary code. Classify it as process execution; its actual containment must hold independently of the name.

Tool discovery is scope-filtered. Only currently available/granted definitions are exposed to the model. Presence in a schema list is not permission to execute; policy still evaluates each action.

A changed implementation/schema or security-relevant binary revision invalidates associated approvals/grants unless a reviewed compatibility rule explicitly permits it.

## 5. Proposal normalization

Inputs contain ToolProposalId, scoped run/turn/step references, stable logical OperationId, tool name/version, and protected typed arguments. Provider call IDs are correlation only, not authorization or canonical operation identity.

Normalizer requirements:

1. Verify trusted scope and current runtime/driver ownership.
2. Look up an enabled reviewed tool definition.
3. Decode the complete argument shape; reject incomplete stream fragments and unknown fields.
4. Validate bounds and map project-relative references to authorized root capabilities.
5. Resolve binary, working directory, targets, inputs, and output destination constraints through trusted adapters.
6. Determine actual effect/resource footprint and sandbox requirements.
7. Freeze preconditions, input/artifact identities, policy revision, and normalized action version.
8. Compute protected/keyed action fingerprints using versioned framing; low-entropy private arguments must not leak through raw public hashes.
9. Produce a safe human preview and protected action record.

No arbitrary JSON dispatch, provider-defined tool auto-registration, eval, raw SQL, absolute path, or unrestricted HTTP argument is allowed.

A complete tool-call JSON object still expresses intent only. A tool result claiming “approved by user” or project AGENTS.md asking to broaden access is untrusted text.

## 6. Policy semantics and inheritance

Policy inputs: trusted actor/execution identity; normalized action; root/account/resource grants; current application/workspace/project restrictions; reviewed agent/task configuration; budget; platform containment evidence; existing standing approvals; risk profile.

Evaluate hard application invariants and administrator locks first. Then combine scoped grants and restrictions. Lower scopes may narrow authority; broadening requires an authorized policy change and cannot cross a hard deny.

A frozen policy snapshot explains the original run decision, but execution also checks current restrictions/revocations. An old snapshot cannot defeat a newly revoked grant. A newly permissive policy is not inherited silently into an existing action.

Decision variants:

- **allow:** all requirements satisfied by current policy and grants;
- **ask:** action may be permitted after exact scoped approval;
- **deny:** prohibited by policy; may propose a different allowed action;
- **block:** containment, target evidence, identity, or required policy information is unavailable/unsafe.

Decision records include stable reason codes, governing rule IDs/versions, required approval conditions, expiry/revalidation rules, and redacted diagnostics. Public explanations are localized and reveal no private path/secret.

Safe/Balanced/Autonomous presets select reviewed rules; they never disable sandboxing, allow arbitrary disk access, or turn off verification. Organizational rank does not grant underlying file/credential access.

## 7. Exact-action approval and grant lifecycle

### Approval preview

Show tool/action, project, safe target display, executable and argv preview where relevant, diff/file count, read/write/network scope, expected consequences, resource/time bounds, reversibility, and meaningful uncertainty. Use bidi/control-character-safe rendering; distinguish executable tokens from explanatory text.

### Scope choices

- approve once: exact normalized action and operation;
- approve for this task: an explicit bounded rule, not all future actions;
- create a project standing rule: separately review allowed tools/targets/binaries/effects/expiry;
- reject.

Never reinterpret “approve once” as consent to a broader rule. Grants bind to policy version, action digest, root/snapshot identity, implementation revision, limits, and authorized approver. Changed arguments, binary, input snapshot, patch, target identity, or resource scope require re-normalization and policy reevaluation; material changes require new approval.

For dynamic code, approving the binary/argv alone is insufficient. Freeze the staging snapshot, lockfile/script/input identity and relevant environment profile. The sandbox constrains unenumerable dynamic effects; approval does not claim to predict every instruction.

### Backend grant states

issued → consumed/active → settled | revoked | expired

Consume/admit the operation atomically with durable dispatch intent. Transport retries use the same operation; a grant cannot be reused to authorize a different action. Single-use semantics do not prove an external effect happened exactly once.

Recheck scope, cancellation, policy revocation, preconditions, epoch, and containment immediately before dispatch. Approval expiration/revocation stops new admission; active processes receive stop/revocation handling. Historical completed effects remain historical facts.

Approval resolution commands are idempotent and compare the pending approval revision. Stale/double conflicting resolutions cannot both execute. Persist waiting approvals; restart does not convert them to allowed.

## 8. First tool contracts

| Tool | Inputs | Effect | Success evidence |
| --- | --- | --- | --- |
| project.read_text | RootGrantId, validated relative path, bounded range/encoding | Authorized read only | Opened object identity, observed content/version, protected excerpt |
| project.propose_patch | Root/snapshot references, target-relative paths, expected content, typed edits | Protected artifact only | Valid patch artifact and baseline references; no project change |
| project.apply_patch | Approved PatchArtifactId, exact target preconditions, OperationId | Brokered mutation | Actual resulting identities/content digests and operation journal settlement |
| project.run_process | Reviewed BinaryGrantId, argv vector, staging snapshot/workdir reference, profile/limits | Arbitrary code inside constrained staging sandbox | Sandbox evidence, process-tree exit, effect manifest, protected outputs |

Read ranges/encoding never turn into unbounded whole-file reads. Denied root access blocks reads even if the model already knows a path. Artifact-only proposal creation does not imply future application approval.

Process exit zero alone is not success for a contract requiring output artifacts/postconditions. Nonzero exit, signal, timeout, resource violation, and security violation are distinct outcomes.

## 9. Filesystem broker and project-root grants

Folder acquisition is an explicit user-facing reviewed flow, with a P0-04 IPC/capability amendment. Renderer paths are hints only; the trusted platform adapter validates and constructs the root capability. Do not add a general filesystem plugin as a shortcut.

A RootGrant records project identity, root file/volume identity, opaque open capability, read/write mode, excluded subtrees/file classes, provenance, revalidation time, and expiry/revocation. Actual OS paths remain protected; user display paths are not authorization.

Default exclusions include secrets, vault/database locations, credentials, symlink/reparse/mount traversal, device files, named pipes/sockets, and unsupported special objects. Dotfiles are not globally harmless: .env, Git configuration/hooks, and similar files require sensitivity/effect-aware rules.

For each operation:

1. Accept a strictly validated relative path.
2. Reject traversal, absolute/drive-relative/device/UNC/verbatim input, NUL, and Windows ADS/reserved names.
3. Resolve components handle-relative with no-follow/reparse-safe semantics.
4. Validate opened object identity/type/permissions—not only a prior canonical string.
5. Detect root/component replacement and relevant hard-link aliasing.
6. Enforce file size, encoding, sensitivity, and scope.
7. Perform operation through the verified handle/capability, without unsafe check-then-reopen.

Test case/canonicalization/Unicode/trailing dots/spaces independently of display normalization. A root prefix match or realpath once followed by later open is insufficient.

Read returns observed content with provenance; it does not promise an atomic snapshot if another process modifies the file. For patch preconditions, require a stable read/digest or reject unstable input.

P0-05 filesystem tests remain mandatory, including junctions/reparse points, symlinks, mounts, ADS, hard links, root swaps, and TOCTOU. Default-deny unsupported cases rather than pretending a string validator handles them.

## 10. Patch proposal and application protocol

### Proposal

Patch artifact contains exact relative targets, expected existence/type/identity/content digest, proposed bytes or bounded edits, baseline snapshot revision, creation scope, and protected review diff. The model cannot replace the baseline with its own assertion.

Initial patch profile supports bounded regular text-file creation/replacement inside approved targets. Delete/rename, binary patches, permission/ACL changes, links, and writes to sensitive policy/CI/hook files are excluded unless a separate reviewed rule allows them. Changes to AGENTS.md/instructions are not silently self-authorized.

### Application

1. Persist approved mutation intent and operation journal.
2. Acquire required target/project write locks.
3. Revalidate grant, current policy, root/target identities, content preconditions, and run control intent.
4. Stage protected approved content into safe same-filesystem temporary files via trusted handles.
5. Preserve permitted metadata deliberately; never unintentionally create executable files or expand permissions.
6. Flush and perform a supported atomic per-file replacement where available; validate resulting identity/content.
7. Persist per-target effect progress and final settlement with postcondition evidence.
8. Release locks and report actual changed files—not merely requested files.

SQLite and host filesystem mutation are not one atomic transaction. A crash between file replacement and result commit creates an uncertain outcome that must be reconciled. Multi-file changes are not claimed atomic.

On partial application, stop and report exact settled/unknown targets. Compensation is a new reviewed action using expected current identity/content; never blindly overwrite user edits with a “rollback.” Store rollback material only under an approved protected retention policy.

Precondition conflict returns stale-target/patch-conflict and makes no new write to the conflicted target. Rebase creates a new patch artifact and review, not permission to apply the old patch to changed content.

## 11. Isolated staging execution

Initial process execution uses a fresh Adham-owned snapshot/worktree-like staging tree, not the live user project as a writable mount.

- Copy only authorized regular-file content through the broker, excluding secrets/links/special objects.
- Record snapshot provenance and input digests; detect unstable reads and avoid claiming a global point-in-time snapshot unless actually established.
- Expose staging read/write plus minimal scratch/runtime dependencies—not the original project, home, vault, Adham storage, Git credential helpers, SSH agent, Docker socket, host service sockets, or provider keys.
- Stage required toolchain/config caches explicitly as read-only safe inputs, or block if unavailable.
- Dependencies must already be provisioned through a separate approved workflow. Running a test does not authorize package downloads/lifecycle installs.
- Generated changes become bounded artifacts/effect manifests. Applying them to the live project requires a separate brokered patch action and current preconditions.
- Git metadata/hook/config exposure requires review; prefer minimal snapshots without live repository credential/config surfaces.

Isolation does not make project scripts trusted. Build/test/lint runners can spawn other binaries and manipulate staging. The profile must contain those behaviors rather than rely on command labels.

## 12. Sandbox enforcement contract

A SandboxProfile declares required and effective guarantees for:

- process identity/privilege and child containment;
- filesystem mounts/access, scratch, and host exclusions;
- network egress and host-service/socket access;
- inherited descriptors/handles and environment;
- process/CPU/memory/time/storage/output limits;
- signal/cancel/kill behavior and cleanup;
- observable security/resource violation evidence;
- platform/version support and known residual risks.

Launch uses a two-phase handshake:

```
trusted core authorizes descriptor
→ runner prepares sandbox and reports effective controls
→ core validates all required guarantees
→ child admitted only inside already enforced boundary
→ bounded execution and result reporting
```

Preparation attestation alone is not proof; platform enforcement probes/adversarial tests establish support. Untrusted code must not run before restrictions apply. Failures in profile creation block launch; no unsandboxed fallback.

### Initial network profile

Deny outbound and inbound networking, including loopback/host-service access and inherited sockets. Deny IPC mechanisms that would let a child ask an ambient privileged service to act on its behalf. Port-only restrictions are not an exact destination allowlist.

Future network-enabled execution requires a mediated egress design covering DNS/address pinning, protocol/origin/path policy, redirects, proxies, local/private destinations, and credential injection. Provider API keys remain in the trusted provider gateway, never in a tool child environment.

### Platform disposition

| Platform | Candidate approach requiring ADR and tests | Release rule |
| --- | --- | --- |
| Windows 10/11 x64 | Restricted/AppContainer or equivalent validated identity + explicit ACL/resource grants + Job Objects/process-tree control | No executable tools until actual filesystem/network/child isolation passes |
| Linux | Verified namespace/mount/no-new-privs/seccomp and/or capability controls, Landlock where supported, process/resource accounting | Probe kernel/ABI/container prerequisites; missing required guarantees block execution |
| macOS | Reviewed supported isolation boundary or a validated VM-based runner with narrowly scoped shared storage | Do not rely on a working directory, Tauri app sandbox label, or undocumented mechanism as proof |

These are candidate strategies, not chosen dependencies or universal support claims. A platform may support brokered read/patch while process execution remains unavailable. UI must reflect per-tool support honestly. Installing virtualization/container runtimes or changing kernel/security configuration requires separate authority. A container with broad host mounts, privileged mode, or a host control socket does not satisfy this contract.

## 13. Executable, argv, environment, and working directory

BinaryGrant identifies an approved executable through trusted path/identity/version and, where feasible, verified digest/signature. Recheck before launch. Bare PATH lookup from renderer/model input is not allowed.

Use a structured argv vector and platform-correct process API. Default no shell, no shell expansion, no command chaining/redirection, no user-selected interpreter executable. If an interpreter is explicitly approved, its script/content snapshot and dynamic authority receive the same arbitrary-code containment treatment.

On Windows, review executable-specific argument parsing and batch/PowerShell launch behavior; passing an argv-looking object is not proof against shell semantics.

Construct a minimal environment allowlist: approved toolchain paths, sandbox HOME/temp, locale, and bounded safe flags. Strip ambient provider keys, proxies, credential helpers, agent sockets, injection/loading variables, Git/global config pointers, and host-private directories unless a specific reviewed profile permits them.

Working directory is a trusted staging-relative capability. Child executable dependencies are permitted by the sandbox profile’s resource scope; dynamic child commands are not globally authorized just because the parent binary is approved.

## 14. Scheduling, locks, and ordering

Tool calls remain children of P0-07 step/attempt state. Policy state and executor state are distinct: requested → normalized → awaiting-approval/authorized/denied/blocked, then queued → dispatching → active → settled/failed/canceled/outcome-unknown.

Never relabel policy denial as a successful tool execution.

Baseline scheduling:

- up to four brokered read-only calls per run;
- one process call per run;
- one live-project mutating call per project;
- global sandbox-process cap defaults to two, subject to resource profile;
- bounded pending tool queue: 64 per installation, with per-project fairness.

Parallelize only reviewed parallel-safe actions with independent resource footprints. Preserve provider/model order for exclusive/order-dependent calls. Default unknown footprint to project-exclusive.

Lock identities include project/root/normalized target identities, not display-path strings. Acquire in deterministic order to avoid deadlocks. A lock coordinates Adham writers only; external user edits still require precondition checks. A staging process does not receive a live-project mutation grant implicitly.

Queue admission, grant consumption, budget reservation, and dispatch intent commit atomically. Cancellation/epoch/policy changes are rechecked before actual dispatch. Approval wait consumes no process slot; approval timeout follows explicit expiry policy.

## 15. Idempotency and effect certainty

Each logical ToolCall has OperationId and immutable action fingerprint. Attempts are distinct. Duplicate commands/requests with matching scope/action return recorded state/result; changed payload/scope conflicts.

Effect certainty:

- not-started: proven no effect admission;
- active: may be producing effects;
- settled: observed result and declared postconditions;
- partial: known subset committed;
- unknown: effect could have occurred without reliable final evidence.

Retry rules:

| Class | Safe baseline |
| --- | --- |
| Pure/brokered read | May retry with bounded policy; fresh result has fresh observed version |
| Artifact proposal | Return existing protected artifact for same operation |
| Patch application | Reconcile target identities/content/journal before any retry |
| Staging process | Retry only under explicit policy after old tree is terminated and effects classified; use fresh isolated staging |
| Future live/remote side effect | No automatic replay without proven idempotency or authoritative reconciliation |

A process producing the same intended output is not necessarily idempotent. A receipt cannot prove a file write or remote message did not happen. No new OperationId may be generated merely to escape an uncertain outcome.

## 16. Cancellation, timeout, revocation, and shutdown

- Persist control intent first; stop new admission.
- Signal the sandbox process tree, not only its parent PID.
- Default graceful stop window: two seconds; force termination and confirm all contained descendants settled within the runtime’s five-second settlement target where the platform supports it.
- Reconcile any brokered mutation already in progress. Atomic per-file replacement may complete despite a late cancel.
- If containment/termination cannot be established, report unknown/block and prevent overlapping retries/new mutable actions.
- Lost core/runner connection triggers fail-closed child termination via the validated platform lifecycle mechanism.
- PID reuse cannot identify recovery targets; use retained platform handles/process identity and sandbox instance/epoch.
- Never leave an orphaned child with continuing host authority or call it canceled solely because IPC disconnected.
- Cleanup removes only Adham-owned staging after output/effect retention and no-live-process checks. No recursive delete follows an unvalidated path or link.

Pause may stop a process only through its defined cancellation behavior; baseline commands are not resumable mid-instruction. Resumption creates a new attempt/staging snapshot after settlement. Saved stdout is not a process checkpoint.

## 17. Result artifacts and limits

ToolResult carries ToolCallId/OperationId/AttemptId, scope, outcome/reason, effect certainty, resource usage, exit/signal status where relevant, postcondition/effect manifest references, and protected output artifacts.

Initial configurable limits:

| Limit | Baseline |
| --- | --- |
| Brokered text excerpt | 256 KiB maximum per read; bounded ranges supported |
| Patch payload | 1 MiB, up to 20 regular text files |
| Readable file size for initial text tool | 8 MiB; larger files require a separate bounded strategy |
| Process wall time | 120 seconds, clipped by run/step deadline |
| Process memory | 1 GiB when enforceable; profile-specific reviewed adjustments |
| Descendant process count | 32, with effective platform enforcement required |
| Staging/scratch writes | 512 MiB enforced quota or equivalent tested hard bound |
| Captured stdout + stderr | 8 MiB total per call |
| Model-visible excerpt | 16 KiB per result, scope-authorized retrieval for more |
| Pending tool queue | 64 per installation |

Do not claim polling-only storage monitoring is a hard quota. If the required limit cannot be enforced, block or approve a different validated bounded profile before launch—not after disk exhaustion.

On output limit, terminate the baseline call and label output-limit/partial rather than silently discarding unlimited bytes while claiming full evidence. Preserve bounded head/tail/truncation metadata where applicable. Escape ANSI/terminal controls and unsafe markup in the UI; never execute links/commands from stdout.

Keep separate raw protected artifact versus model-visible sanitized excerpt. Redaction cannot guarantee absence of all secrets: avoid mounting secrets, apply deterministic canary-tested filters, and require privacy policy approval before sending tool content to cloud models. Retrieval always checks original scope/content authorization.

## 18. Sandbox runner protocol

Use a versioned bounded local authenticated channel such as inherited/private pipes or an equivalent platform facility—not an unauthenticated localhost service.

Messages bind sandbox instance, immutable scope, OperationId/AttemptId, driver epoch, profile/action version, and sequence. No arbitrary raw shell/path protocol is exposed.

Protocol operations: prepare, effective-profile report, launch, bounded progress/output, request-stop, observed-settlement, and reconciliation/status. Reject unknown versions/types, oversized/duplicate/stale frames, forged instance IDs, and wrong epochs.

The runner receives only scoped descriptors/capabilities needed for the call. It does not receive the SQLite database, global keys, provider vault, policy editor, or event append endpoint. Child output cannot become runner control messages; maintain channel separation/framing.

If the IPC channel is lost, child lifetime is fail-closed and state is reconciled. Do not infer clean termination from a missing heartbeat alone.

## 19. Durable journal and recovery

Canonical facts and protected artifacts are authoritative; in-memory executor queues are not.

For tool dispatch, atomically commit normalized action reference, policy/approval/grant state, attempt dispatch intent, budget reservation, and pending operation journal. Start the effect after commit. Result commit records observed evidence, effect certainty, budget settlement, runtime attempt closure, and projections.

Cross-boundary ambiguity is explicit: a crash after dispatch intent but before process start is indistinguishable without executor evidence; a crash after file replacement but before SQLite result commit requires filesystem reconciliation.

Recovery:

1. Fence old runtime/runner epochs and acquire scheduler ownership.
2. Verify affected event/journal integrity and protection availability.
3. Locate active sandbox instances with trustworthy retained identity; terminate/reconcile before overlapping work.
4. Check filesystem patch intents against expected/pre/post identities/content through the broker.
5. Record settled/partial/unknown outcomes; never silently rerun mutations.
6. Honor earlier cancellation/revocation before resume.
7. Restore held approvals as pending/expired, not implicitly allowed.
8. Keep unknown effects blocked until an authorized resolution with evidence.
9. Preserve evidence and original protected state; no automatic history deletion or blind rollback.

Replay/rebuild never launches a process, applies a patch, sends an approval, or changes grants by inference.

## 20. Events, projections, and IPC amendment

Use reviewed P0-02 event families: tool/call-requested, policy/decision-recorded, approval/requested, approval/resolved, tool/call-started, tool/call-succeeded, tool/call-failed, tool/call-canceled. Extend with explicit grant/revocation, patch/effect journal, sandbox-profile, and reconciliation facts where needed.

Reserve safe reason enums and distinguish policy-blocked, execution-failed, partial, and outcome-unknown. Align authority with P0-07 step/attempt closure to avoid conflicting terminal facts. All schemas are registered/versioned and compatibility-tested before implementation.

Private arguments, relative/raw paths, command previews, diffs, stdout/stderr, and sensitive hashes belong in protected content/artifacts. Structural events contain references, typed IDs, safe status, versions, counts, and causation.

Frontend views: tool proposal/approval, pending/executing state, bounded output, observed effects/diff, sandbox support, policy explanation, and unresolved outcome. Notifications contain scope invalidation only.

Required P0-04 amendments may include AcquireProjectRootGrant, ProposePatch/ApprovePatch, ResolveApproval, GetToolCall/GetToolOutputPage, and scoped root/grant revocation. These are proposals, not authorized native commands until DTOs, allowlist, permissions, validators, limits, idempotency, and tests are reviewed together.

Never expose RunAnyCommand, ReadAnyFile, SetPolicyFromModel, AppendToolEvent, or a generic sandbox dispatch endpoint to the renderer.

## 21. Rust ownership and dependency review

- **adham-tools:** registry, normalized actions/results, scheduling and tool application services.
- **adham-policy:** rule evaluation, provenance, approval and grant lifecycle.
- **adham-platform:** root/path/handle adapters and brokered filesystem operations.
- **services/sandbox-runner:** local runner protocol and platform-enforced execution lifecycle.
- **adham-runtime:** tool-step integration, cancellation, retries, budgets, and recovery orchestration.
- **protected artifact port:** large/private outputs and manifests; no unprotected runtime dumps.

Domains depend on typed ports, not OS/SQLx/Tauri implementations. Concrete sandbox backends live behind platform adapters. Unsafe platform code, if necessary, is narrowly isolated/reviewed with an explicit exception; never remove the repository’s unsafe policy globally.

Split client/protocol, normalization, policy, approvals, scheduling, grants, paths, patch, process, limits, outputs, and recovery into cohesive modules. Target files under 300 lines; review above 400; require a documented exception above 600.

No sandbox library/container/VM/runtime is approved here by name. Compare candidates under a platform ADR with dependency/license/security/maintenance/privilege/installation impact and adversarial evidence. Do not install or change host services/security configuration without separate authority.

## 22. Security and failure test matrix

| Area | Required tests |
| --- | --- |
| Normalization | Unknown tool/version; malformed/incomplete args; unsafe shell forms; target/binary/action changes |
| Policy | Hard deny beats approval; locked inheritance; revoked grants; preset cannot disable containment |
| Approval | Once/task/rule scope; forged approver; expired/stale revision; duplicate/conflicting resolution; changed diff/input invalidates |
| Paths | Traversal, ADS, devices, UNC, drive-relative, mixed separators, reserved names, Unicode/case/trailing dots/spaces |
| Object identity | Symlink/junction/reparse/mount/hard link; root/component swap; TOCTOU; special object denial |
| Patch | Precondition mismatch; per-file replacement; multi-file partial failure; crash after effect before receipt; compensation cannot overwrite edits |
| Sandbox filesystem | Outside-root/home/vault/DB reads and writes denied; no host project mutation from staging |
| Network/IPC | External and loopback traffic denied; inherited sockets closed; proxy/env injection; host service/control socket escape |
| Process containment | Fork/child escape, breakaway, descendant termination, PID reuse, runner/core crash, child cannot forge control frames |
| Resources | CPU/time/memory/process/storage/output bounds enforced; fail profile before launch when unsupported |
| Scripts/environment | Build/test scripts execute arbitrary code but remain confined; no ambient SSH/cloud/Git credentials or injection variables |
| Scheduling | Exclusive ordering, scoped lock collisions, fairness, bounded admission, cancel/revocation before dispatch |
| Idempotency | Same operation returns prior state; changed payload conflicts; unknown effect cannot blind retry |
| Privacy | Canary absent from events/logs/notifications/public errors; protected raw artifacts; cloud excerpt transfer denied when policy forbids |
| Recovery | Kill at each intent/dispatch/effect/result boundary; no silent replay/rollback; pending approval survives |
| Platform support | Actual native tests per OS/kernel/architecture/profile; compile-only does not count as containment evidence |
| Task verification | Zero exit/tool success cannot mark task complete without P0-10 gate |

Use disposable synthetic project roots and sacrificial outside-root canary files. Never test escape/destruction against real user data. Add race loops/adversarial helper binaries to exercise handle replacement and descendant behavior; a fake runner cannot prove OS isolation.

## 23. Implementation and acceptance gates

### G1 — Pure policy/action core

- [ ]  Registry schemas, normalizer, policy precedence, approval scope, and result/effect certainty types accepted.
- [ ]  Deterministic/property tests pass; no native effects yet.

### G2 — Read/propose broker

- [ ]  Root grant flow and filesystem identity semantics reviewed.
- [ ]  Full P0-05 path/object test matrix passes on claimed platforms.
- [ ]  Bounded protected reads/patch proposals work without mutation or secrets.

### G3 — Patch application

- [ ]  Exact approval and content/identity preconditions tested.
- [ ]  Per-target journal, partial-result semantics, crash reconciliation, and safe compensation tested.
- [ ]  No SQLite/filesystem global-atomicity claim.

### G4 — Platform sandbox proof

- [ ]  Platform ADR/dependencies/installation approved.
- [ ]  Effective filesystem/network/process/resource guarantees measured with adversarial native tests.
- [ ]  Unsupported profiles disable executable tools; no fallback outside containment.

### G5 — Runtime integration

- [ ]  Epoch fencing, bounded scheduler, grant consumption, result artifacts, cancel/revocation, and recovery pass.
- [ ]  Live project changes occur only through separately approved brokered patches.
- [ ]  IPC/schema/capability amendments reviewed and generated contracts committed.

### Final gate

- [ ]  Every validated tool/platform profile has reproducible evidence and known residual risks.
- [ ]  Project/account/content scope cannot cross through grants, caches, outputs, or recovery.
- [ ]  Side effects and unknown outcomes remain explicit; no blind retries or silent compensation.
- [ ]  No host secret/network/general shell authority was added by convenience.
- [ ]  Audit/license, source boundaries, native security tests, and persistent runtime gates remain green.
- [ ]  Required skipped/failed security checks are blockers, not warnings or completion claims.

## 24. Stop conditions and next artifact

Stop admission and preserve evidence on missing containment, policy/grant mismatch, changed root/binary/patch identity, sandbox escape, leaked credentials, failed resource limits, orphaned process, corrupted journal, or uncertain mutable outcome.

Revoke transient authority, stop affected process trees where safe, quarantine the sandbox/tool profile, and show exact known effects/uncertainty. Do not grant broader mounts, disable host security/TLS checks, inherit more environment variables, retry with a new operation identity, or erase evidence to make the task pass.

The next specification is **P0-10 — Verification gate and evidence-backed completion contract**. It will define task-specific mandatory checks, scope/diff preservation, trustworthy evidence collection, result freshness, warning/waiver authority, bounded remediation, and final completion determination. P0-09 supplies controlled actions and observed effects—not permission for a model to declare success.