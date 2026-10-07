<aside>
📦

A plugin packages capabilities; it does not elevate their authority. Validate portable format, package containment, publisher/content provenance, component permissions, and effective isolation independently. A valid signature, marketplace badge, or successful install is not permission to execute or proof that the package is safe.

</aside>

## Purpose and implementation boundary

Define portable package conformance and Adham-specific trust/lifecycle: discovery, supply-chain identity, permission review, immutable installation, scoped data, isolation, activation, updates, migrations, rollback, revocation, quarantine, uninstall, and evidence.

Initial implementation:

1. Load a user-selected local package directory as inert content.
2. Validate and snapshot its portable skills/MCP components using P0-13.
3. Install immutable reviewed package content into app-owned storage without executing hooks.
4. Assign exact components to named scopes, disabled by default until their own grants are accepted.
5. Support explicitly reviewed update/disable/rollback/uninstall with durable recovery.

Limited declarative Adham contributions may be added only after their schema/action mapping is accepted. Arbitrary custom UI, executable hooks, native libraries, WebAssembly components, marketplace purchases, online publisher registration, automatic update feeds, and deep OS extensions are outside the first profile.

This specification does not authorize downloads, installation, signatures/key creation, host changes, plugin execution, authentication, publication, purchases, or deletion of user data.

### Governing specifications

- Architecture — Plugin system.
- P0-13 — Skills and MCP capability contract.
- P0-09 — Tools, policy, and sandbox execution contract.
- P0-10 — Verification gate and evidence-backed completion contract.
- P0-11 — Task graph and isolated subagent execution contract.
- P0-12 — Governed local memory contract.
- P0-04 — Typed IPC, capabilities & frontend sync.
- Architecture — Global and project file paths.
- P0-06 — Repository scaffold execution and evidence checklist.

## 1. Verified portable-format baseline and corrections

Agent Plugins 1.0.0 defines plugin.json, skills/, mcp.json, reverse-domain client namespaces, package-path containment, and PLUGIN_ROOT/PLUGIN_DATA. The package containment rules do not sandbox subprocesses or constrain arbitrary runtime paths; Adham must supply those controls separately.[[1]](https://agent-plugins.org/specification)

The inspected specification requires the recognized canonical $schema in plugin.json, locally selected schemas without network fetching, and specific nonfatal manifest handling: report/ignore unknown top-level fields; report/ignore a non-object extensions field; ignore unimplemented namespaces without interpreting their values. Other fatal manifest violations prevent discovery/execution. Implement these distinctions rather than rejecting every unknown field or treating unknown fields as permissions.[[1]](https://agent-plugins.org/specification)

For subprocesses, the specification requires client-owned PLUGIN_ROOT and dedicated persistent PLUGIN_DATA, single nonrecursive expansion in supported fields, reserved-variable protection, and configured cwd containment. Portable mcp.json schema version must match the package’s selected format version; invalid MCP configuration does not automatically invalidate other valid component types.[[1]](https://agent-plugins.org/specification)

**Precedence correction:** earlier minimal manifest/layout examples in the architecture brief are illustrative. P0-14’s pinned conformance profile and checked-in normative schema fixtures govern implementation. A plugin name/version/author field is not a cryptographically authenticated publisher or immutable content identity.

Publisher signatures, permission overlays, trust tiers, Adham install receipts, catalog authorization, and revocation metadata are **Adham client/distribution policies**, not portable-standard fields claimed to exist universally.

## 2. Core invariants

1. Parsing/discovery/installation is inert; no install/postinstall/activation script executes automatically.
2. Package format conformance, content integrity, publisher identity, trust review, and runtime authority are separate dimensions.
3. Unknown portable fields/namespaces never acquire Adham semantics.
4. Immutable installed package bytes are bound to a content digest/manifest; a version label alone is insufficient.
5. Installed globally does not mean enabled globally. Component grants are named-scope, principal, operation, and revision specific.
6. Skills/MCP retain every P0-13 restriction; bundling them cannot grant tools, memory, credentials, or background execution.
7. Third-party code never loads into the trusted Rust core or main renderer.
8. Mutable plugin data is separate from package content and partitioned by runtime scope/account where needed.
9. Updates do not silently replace pinned active components or inherit broader permissions.
10. Rollback restores a reviewed compatible package/data state; it is not blind data downgrade or permission restoration.
11. Revocation overrides pinning/standing grants for new admission; active work is stopped/reconciled safely.
12. Filesystem changes and SQLite receipts are not one globally atomic transaction; lifecycle journals handle crash ambiguity.
13. Uninstall does not delete personal forks, user projects, or memories without separate explicit scope/authority.
14. Badges/scans/signatures cannot replace sandbox/policy/verification evidence.
15. Replay rebuilds lifecycle projections; it never downloads, installs, executes, migrates, or deletes by inference.

## 3. Package identity, publisher identity, and install instances

Objects:

| Object | Responsibility |
| --- | --- |
| PackageArtifact | Exact inert source/archive/snapshot bytes plus provenance |
| PortableManifestProfile | Recognized format version and local normative validation rules |
| PublisherIdentity | Independently established source/key/organization identity with review status |
| PackageVersionIdentity | Publisher/package identity, declared version if present, exact content digest |
| InstallReceipt | Adham-owned immutable validation/trust/component inventory record |
| PluginInstallation | Reviewed package version registered locally, initially disabled |
| PluginRuntimeInstance | Scope/account/grant-bound component execution and dedicated mutable data |
| ComponentBinding | Exact skill/MCP/declarative contribution revision and permission profile |
| LifecycleOperation | Durable install/update/activation/migration/rollback/uninstall journal |

Backend IDs: PackageId, PackageArtifactId, PublisherId, PluginInstallationId, PluginInstanceId, InstallReceiptId, LifecycleOperationId, DataGeneration, and RevocationGeneration. Reuse P0-13 skill/connection/binding identity and runtime/tool operation IDs.

Portable version metadata may be absent or insufficient for managed updates. A local package can be identified by a content snapshot; managed update comparison requires an accepted immutable distribution identity and version policy. Do not invent a version and claim the publisher supplied it.

Same publisher/package/version with different bytes is a conflicting/reissued artifact needing explicit review, never a silent replacement. A valid author email/homepage/repository is descriptive provenance—not verified ownership.

## 4. Supported portable layout and Adham namespace

```
package/
├── plugin.json
├── skills/
│   └── skill-name/
│       ├── SKILL.md
│       ├── scripts/
│       ├── references/
│       └── assets/
├── mcp.json
├── si.adham.desktop/
│   └── contributions.json
├── README.md
├── LICENSE
└── CHANGELOG.md
```

Only standard-required files are mandatory under the selected schema; optional examples are not invented conformance requirements. Use si.adham.desktop as the stable reverse-domain client extension namespace.

Adham-only manifest data goes under extensions.si.adham.desktop; files go under its matching top-level directory. Never add arbitrary permission/runtime/UI semantics to portable root fields.

Adham extension validation is independent of portable conformance. Unsupported client-specific contribution types remain inert/disabled with explicit reason. Define fatal versus component-scoped extension failure so one invalid UI contribution cannot silently change skill/MCP grants or conceal a package security violation.

Minimal portable example:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "example-toolkit"
}
```

This manifest says nothing about trusted publisher, signing, granted permissions, or safe execution.

## 5. Acquisition, archives, and safe extraction

Local directory loading requires an explicit authorized selection, broker-resolved identity, and immutable snapshot. A mutable source directory never becomes trusted production content merely because validation passed once.

Archive/network acquisition is a separate supported-profile gate. When implemented:

- approve source/origin, TLS/proxy/redirect policy, download size, and trust metadata;
- no model-controlled authenticated download endpoint or auto-open;
- write only to validated app-owned staging through safe handles;
- enforce compressed/unpacked bytes, file count, depth, compression ratio, and wall time;
- reject absolute/traversal/drive/device/UNC/ADS paths and unsupported encodings;
- reject symlinks/hardlinks/reparse/special files and mount escapes in the initial profile;
- detect case/Unicode/path collisions and duplicate archive entries before writes;
- handle Windows reserved names/trailing dots/spaces and platform normalization;
- never execute extracted files or follow package-provided installer/schema/network URLs;
- extract with safe permissions; no preserved setuid/executable/ACL authority by default;
- verify the final extracted object identities/content manifest, not archive headers alone.

Suggested initial limits: 50 MiB downloaded, 200 MiB unpacked, 5,000 regular files, depth 16, ratio 100:1, 60-second staging deadline. Profile changes require explicit resource/security review; large legitimate packages can be blocked rather than extracted unboundedly.

A package-path containment failure is a security failure for the affected artifact, not a harmless unknown field. Preserve bounded protected evidence and quarantine without running components.

## 6. Local schema validation and component inventory

Pin Agent Plugins specification/schema bytes and conformance fixtures in the repository; recorded digests and reviewed updates establish interpretation. A package $schema selects known local rules, never downloads code/schema during load.

Manifest parser rejects duplicate keys/type/size/depth violations and applies exact nonfatal rules from the pinned version. Unimplemented namespaces are ignored semantically without remote loading; generic package path/security scanning still applies to all bytes.

Component inventory:

- validate skills under P0-13, including immutable body/scripts/resources and source identities;
- validate portable MCP entries/version/transport/command/env/cwd/placeholder semantics;
- show unsupported legacy SSE or protocol profiles explicitly; do not auto-enable them;
- classify Adham contribution schemas separately;
- record actual files/binaries/dependencies/network/credential references and relevant uncertainty;
- compare declarations with discovered content and implementation requirements.

Portable validity and client availability are distinct. An unsupported transport can remain a valid but unavailable component. Invalid component configurations are disabled with exact reasons under the portable profile; no best-effort partial execution of malformed entries.

Do not infer permissions from README or marketing descriptions. A package requesting a server/binary that downloads dependencies at startup remains blocked until provisioned through a separate reviewed workflow.

## 7. Publisher trust, integrity, signing, and scans

Trust dimensions recorded separately:

- source/publisher identity verified, unverified, or disputed;
- content digest/manifest integrity;
- signature status and signer authorization;
- automated scan results/coverage/version;
- manual review status and exact reviewed version/components;
- organization approval and exact permitted scopes;
- runtime containment/support profile.

Suggested displayed tiers: Unverified, Community verified, Adham reviewed, Organization approved. Define actual evidence requirements before displaying a tier; do not manufacture a badge based on install success or download count. Organization approval cannot override hard safety gates.

Signature profile is an Adham distribution ADR: exact envelope/algorithm/trust root, signed payload (publisher/package/version + canonical content manifest), key distribution/rotation/revocation, expiry/freshness, and offline verification rules. Signature files cannot authorize themselves; an embedded public key is not automatically trusted.

Verify against approved keys and exact content before activation. A compromised authorized signer can still sign malicious content; sandbox/permission review remains required. No mandatory online contact just to load a reviewed local skill package unless its explicit trust policy requires freshness.

Scan scripts/binaries/manifests for malicious patterns, secret exposure, vulnerable dependencies, unsafe commands, excessive permissions, and prompt-injection indicators. Scans have coverage/false-negative limits; missing scanners/unsupported binaries are unknown evidence, not a clean result.

Unsigned local/community packages may be reviewed for restricted enablement with strong warning and current policy approval. They cannot run unavailable sandbox profiles, request broad credentials, or inherit automatic updates. Some higher-risk components may remain blocked regardless of approval.

## 8. Permission overlay and installation review

Create a protected Adham PermissionReview separate from portable package metadata. It binds exact package digest/version and discovered component revisions.

Show:

- supplied skills and inert resources/scripts;
- MCP startup binaries/transports/accounts/tools and disabled default state;
- exact read/write/project/staging filesystem needs;
- network destinations/proxy/remote retention disclosures;
- credential references/scopes and whether a child process can see injected secrets;
- mutable data/storage/resource limits;
- background execution request and lifecycle implications;
- declarative/custom/native contributions and support status;
- requested workspace/project/agent/task assignments;
- unverified capabilities and residual risk.

The user selects components and target scopes. Install consent approves storage/registration only—not execution, account authentication, all tools, cloud transfer, memory, or live-project writes.

Component grants are P0-09/13 policies. A plugin cannot request all future tools or change its own approval rules. Trust tier affects review requirements, never grants authority automatically.

## 9. Immutable packages and scoped mutable data

Conceptual app-owned layout, resolved by trusted platform adapter:

```
plugins/
├── packages/<opaque-package>/<content-version>/
├── instances/<opaque-instance>/data/<generation>/
├── staging/<operation-id>/
├── receipts/
└── quarantine/<artifact-id>/
```

Installed package content is immutable/read-only. Untrusted component processes cannot write package bytes, other instance data, installation receipts, policy records, or vault/DB.

Shared read-only package bytes may serve several instances. Writable data is partitioned by project/account/grant binding, not one global bucket containing every project’s history. Each runtime instance has dedicated client-managed PLUGIN_DATA; user/organization-wide shared storage requires a later explicit access model.

Provide client-owned PLUGIN_ROOT/PLUGIN_DATA to supported subprocesses, using actual sandbox-visible resolved locations consistent with the implementation profile. Prevent package-config override of reserved variables under platform case semantics. Expansion is exact single-pass in supported fields only, not shell/environment evaluation.

Default working directory/explicit cwd follow pinned portable rules, but containment still comes from the sandbox. A spec-valid cwd beneath plugin data is not permission to run or reach the host home directory.

Plugin data is untrusted and potentially sensitive. Protect data/export/retention under profile; no automatic plaintext secrets or shared memory. Data schemas/indexes remain owned by the component but controlled by instance permissions and lifecycle journal.

## 10. Install and activation transaction

Lifecycle states: proposed → staged → validated → reviewed → installed-disabled → enabled-components. Failed, blocked, quarantined, revoked, and removal-pending are distinct; active runtime state remains separate.

Ordered install:

1. Authorize inert acquisition and create LifecycleOperation/receipt intent.
2. Stage and snapshot exact bytes safely.
3. Validate portable/components/namespace/security/resource conformance.
4. Verify source/content/signature/scan evidence under current policy.
5. Record component/permission inventory and obtain required review.
6. Prepare immutable package location and scoped data metadata with safe permissions.
7. Journal filesystem placement and validate final object/content identity.
8. Atomically register installed-disabled state, receipt, component bindings, and projections in SQLite.
9. Reconcile any placement/registration ambiguity before activation.
10. Enable individually selected components only through current separate grants.

No package-controlled hooks execute during install. Directory rename may be atomic on the supported filesystem; SQLite registration is a separate boundary. Recovery must handle orphan staged/package objects and receipts without treating them as approved execution.

Activation rechecks digest, package/instance identities, current policy/trust/revocation generation, component/schema revisions, resource and sandbox support, grants, and run pins. A corrupted package after installation is quarantined, not repaired by recomputing its expected digest.

## 11. Runtime isolation by component class

| Component | Execution boundary | Initial support |
| --- | --- | --- |
| Skill instructions/assets | Protected contextual data and bounded broker reads | Supported under P0-13 |
| Skill scripts | P0-09 sandboxed process with exact snapshot/grant | Only validated platform/profile |
| Local MCP server | Scoped sandbox instance/private stdio | P0-13 supported subset |
| Remote MCP server | Approved HTTPS/account/protocol binding | Separately approved P0-13 profile |
| Declarative contribution | Trusted Adham renderer interprets closed inert schema | Optional limited schema gate |
| Arbitrary custom UI | Isolated unprivileged surface and narrow broker bridge | Deferred |
| WASM/native extension | Explicit isolated host/privilege/resource contract | Deferred |

Separate process alone is not containment. Plugin-host processes orchestrate isolated components with no global policy/vault/event authority. P0-09 effective OS guarantees remain mandatory.

No dynamic library injection, Rust dlopen, Node execution in the main renderer, arbitrary React imports, host DOM mutation, or Tauri command access for third-party code. High-trust/native future extensions remain isolated; signing is not an in-process exemption.

Unsupported platform/profile disables the component visibly. Do not launch unsandboxed to preserve marketplace compatibility.

## 12. Declarative Adham contributions

A first closed contribution schema may support inert labels/settings descriptions, reviewed template references, and actions mapped to existing trusted canonical commands.

Rules:

- versioned namespace schema with bounded strings/collections/references;
- no JavaScript expressions/eval, HTML event handlers, arbitrary remote embeds, CSS injection, executable template hooks, or automatic URL/file fetch;
- contribution/action IDs namespaced to exact plugin instance/version;
- controls show source badge, permission requirements, and disabled/unavailable state;
- no automatic shortcut collision replacement or settings-policy edit;
- command selection is a proposal routed through trusted policy, not a raw IPC invocation;
- templates/agent/workflow definitions remain inert drafts requiring review before grants/execution;
- accessible keyboard/RTL/reduced-motion/high-contrast behavior is owned/tested by Adham UI.

A malicious plugin cannot render an approval screen impersonating the trusted permission broker. Trusted consent/credential UI remains visibly separate and cannot be supplied through declarative content.

Unknown contribution types are unavailable; do not interpret generic URL/script fields permissively.

## 13. Future custom UI/plugin-host contract gate

Before enabling custom UI, separately specify/process-test:

- isolated origin/webview/renderer, no privileged main window authority;
- strict CSP, no Node/native APIs, no arbitrary host navigation/network;
- opaque instance/epoch-bound authenticated message bridge;
- allowlisted typed requests with scope/current grants/rate/size limits;
- plugin-specific storage/data generation only;
- UI event source/provenance and trusted permission prompts;
- forbidden credential/policy/event/file/provider generic operations;
- lifecycle teardown, callback fencing, crash/recovery, and accessibility testing.

For WASM/native hosts, define imported functions, memory/CPU/fuel/IO limits, engine/ABI versioning, compilation/cache integrity, and OS isolation. WASM runtime marketing does not prove capability safety; unsafe host imports can bypass it.

These surfaces are deliberately disabled in initial P0-14. Declaring them in a package does not make them supported or authorized.

## 14. Updates and permission drift

No silent automatic update/activation. User reviews an exact candidate version/artifact and diff. Remote update checks, if later enabled, use separately approved feed/origin/freshness rules without leaking project content.

Update comparison includes publisher/key/content identity, portable/namespace schemas, skill body/scripts, MCP endpoints/binaries/auth/protocol/tool schemas, dependencies/native components, data migration requirements, network/filesystem/credential/background requests, and effective behavior—not just manifest version.

New/materially changed authority requires approval. Unchanged declarations cannot hide changed scripts/endpoints/tool behavior; code changes may invalidate review under policy. New MCP tools remain disabled.

Active runs pin exact package/component snapshots. Default update activation waits for affected work to pause/settle and compatible data isolation; no hot substitution inside active context/process. An old version may continue only if current policy permits and distinct data generations prevent incompatible sharing. Revocation cancels that exception.

Update installs side-by-side as disabled candidate, verifies, prepares data compatibility, atomically switches trusted active binding metadata, then activates permitted components. No shared writable data migration while old/new instances are both active.

## 15. Data migration and rollback

Package version and data generation are separate. Record compatible schema ranges and migration strategy in reviewed Adham instance metadata/namespace—not invented portable root fields.

Before migration:

1. Stop/fence affected instances and settle effects.
2. Snapshot protected scoped plugin data with verified coverage/retention.
3. Record old/new package identities and data generation compatibility.
4. Obtain authority for any executable migration and run only in a constrained staging copy.
5. Validate resulting data and side effects through reviewed predicates.
6. Activate new generation only after settlement and durable journal updates.

Package-controlled migration is untrusted code, not a trusted core callback. Initial profile may simply block incompatible migrations until a validated mechanism exists.

Rollback requires a reviewed nonrevoked earlier package plus compatible verified data generation. Never point an old binary at an irreversibly upgraded DB or restore stale plugin grants automatically. If data cannot safely downgrade, hold disabled and offer an explicit protected restore/export decision.

Failed update leaves prior registered package/data untouched where possible. If effects occurred, report partial/unknown coverage and reconcile; do not claim filesystem+DB+plugin mutation globally atomic. Retain evidence and preserve user work.

## 16. Publisher changes, revocation, and downgrade protection

Signer/publisher changes require an explicit continuity/rotation review using trusted evidence. Package-provided “new key” text does not authorize a replacement signer.

Revocation metadata, when implemented, needs its own signed source/freshness/offline policy and scoped records. Unverified online notices cannot delete/execute locally. Offline inability to refresh a required trust feed yields stale/blocked assurance, not presumed clean status or forced network access.

Keep a monotonic protected revocation ledger outside restore candidates; apply current restrictions before package activation/rollback. A rollback cannot reactivate a revoked digest. Full-host rollback limitations must be stated; no claim the ledger survives every compromise/restore.

Distribution downgrade/freeze attacks require reviewed version/freshness/channel rules and trusted source evidence. Initial manual local installs rely on explicit digest/source review; do not advertise automatic anti-rollback protection without that implementation.

## 17. Quarantine and incident behavior

On integrity mismatch, unsafe containment, credential exposure, suspicious code/schema change, violated policy, or confirmed revocation:

- stop new component admission immediately;
- invalidate instance grants/context/cache generations;
- signal affected process trees/remote calls and reconcile effects;
- mark components/installation quarantined/revoked with exact reason;
- preserve bounded protected evidence;
- show known effects/uncertainty and safe review/export/restore options;
- never upload private evidence automatically or retry through another plugin.

Quarantine is app-owned protected storage and disabled registration, not executing scanners/hooks with package authority. Suspicious content remains inaccessible to agents except an explicitly authorized inert diagnostic review. Cleanup cannot follow malicious links or delete outside quarantine.

A user may inspect an unsigned package; approving inspection is not approving runtime privileges. Security invariants cannot be overridden by a “trust anyway” button.

## 18. Disable, uninstall, and data retention

Disable stops new admission and handles active work according to current safe-settlement policy. UI hiding is insufficient; child bindings, scheduled jobs, and remote/server handles must lose usable authority.

Uninstall flow previews exact installation/components, dependent agents/workflows, active effects, scoped data, forks, and known exports/memory-derived content.

- terminate/reconcile owned instances before removal;
- revoke grants and mark dependent configurations needs-configuration;
- remove selected immutable package references only when no permitted live pins remain;
- treat each instance data deletion/export as explicit user choice under protection/retention policy;
- preserve user-created skills/forks and unrelated project files;
- leave provider/MCP account credentials untouched by default unless their sole ownership and deletion authority are established;
- do not silently delete memories created from results—P0-12 governs source/derivative deletion scope;
- journal filesystem cleanup and report incomplete removal honestly.

A globally shared immutable version may remain physically present for another authorized instance; uninstall one instance is not a claim all package bytes were erased. Remaining backups/exports/key/data copies follow declared deletion limitations.

## 19. Developer mode and local forks

Developer mode loads a user-selected immutable snapshot into a disposable isolated profile with visible unverified/dev status. It does not bypass path validation, sandboxing, policy, credentials, or verification.

Source file changes produce new revisions; reload is explicit/opt-in and never modifies active production pins. File watchers observe only authorized roots and bounded events.

Personal/workspace forks get independent canonical identities and provenance. Updates never overwrite customization; upstream comparison/merge creates a new reviewed snapshot. Friendly names cannot shadow pinned bundled components.

Dev packages remain unavailable in restricted/organization scopes until approved. A debug flag cannot expose generic native commands or turn off security to make a plugin work.

## 20. Marketplace/distribution metadata boundary

Marketplace is future distribution UI, not a trusted execution channel. Listings should identify actual publisher evidence, exact version/digest, license, compatibility, included components, requested permissions/destinations, review coverage, update history, issues, and paid/free status.

Marketing claims, popularity, ratings, sponsor status, or payment receipt do not grant privileges. Paid and free packages use the same validation/isolation model. Purchases/licensing/payment/auth require separate user authority and are excluded from initial implementation.

Permission changes cannot be hidden behind a subscription/update renewal. Publisher-controlled images/HTML/URLs are sanitized/inert and fetched only under reviewed display-network rules outside privileged execution.

Do not claim conformance/security certification for every marketplace item because the client supports the portable loader. Publish exact compatibility/security profile and untested features.

## 21. Durability, recovery, and cleanup

Lifecycle journal records operation ID, exact package/source/current/candidate/data identities, approvals, staged/placed/registered/activated phases, grant generations, effect certainty, and final settlement.

Recovery:

1. Fence old hosts/instances and load current policy/revocation ledger.
2. Verify package/receipt/data/operation integrity.
3. Reconcile staged filesystem placements and SQLite registration without executing content.
4. Hold ambiguous candidates installed-disabled/quarantined.
5. Reconcile active process/effect/migration state before any activation/retry.
6. Restore last validated compatible registered binding; do not infer rollback safety from file presence.
7. Resume cleanup only for verified app-owned paths and scoped journal entries.
8. Preserve pending review decisions and identity changes; no automatic consent on restart.

Crash windows include acquisition, extraction, validation, package placement, receipt commit, data migration, active binding switch, process start, revocation, and uninstall. A duplicated request uses original receipt/journal; no second install/activation effect by inventing IDs.

Application backups/restores apply current deleted/revoked instance records before activation. External backup/full-host rollback limitations remain explicit. Replay alone never fetches updates or relaunches code.

## 22. Events, protected metadata, and IPC amendment

Register versioned plugin acquisition/validation/review/install/component assignment, instance activation/suspension, update/migration/rollback, revocation/quarantine, uninstall, and reconciliation facts.

Structural events contain IDs, exact content-version references, safe status/reason/count/version/generation, and protected evidence references. Paths, component descriptions/private configs, credentials, scan findings with sensitive bytes, data manifests, and user/project assignments with sensitive labels remain protected.

Projections show exact installed/active/pinned/candidate versions, scoped component grants, effective support, data compatibility, review/trust evidence, active tasks, incidents, and cleanup progress. Skill/MCP execution uses P0-13/tool events, not a plugin-private append authority.

Proposed application commands: PreviewPluginPackage, ReviewPluginInstall, InstallReviewedPlugin, AssignPluginComponents, DisablePluginInstance, PreviewPluginUpdate, ActivateReviewedUpdate, RequestPluginRollback, QuarantinePlugin, PreviewPluginRemoval, and RemovePluginInstance.

These are not permitted Tauri endpoints until P0-04 allowlist/DTO/capabilities/limits/idempotency/redaction/generated type/authorization tests are amended. No arbitrary archive-path extraction, plugin-code eval, unrestricted host bridge, force-trust, or download-and-execute command.

Trusted permission/credential prompts remain first-party and cannot be supplied by plugin UI. Notifications contain exact-scope lifecycle invalidation only.

## 23. Rust ownership and dependency policy

adham-extensions owns package/instance/contribution lifecycle and component bindings; adham-policy owns grants/trust-policy evaluation; platform/artifact adapters own safe staging/path/protection; sandbox runner/plugin-host boundaries own execution; runtime/context/graph/memory/verify retain their domain authority.

Suggested cohesive modules:

```
crates/adham-extensions/src/
├── domain/
│   ├── package.rs
│   ├── publisher.rs
│   ├── receipt.rs
│   ├── permission.rs
│   ├── instance.rs
│   ├── contribution.rs
│   └── lifecycle.rs
├── application/
│   ├── validate.rs
│   ├── review.rs
│   ├── install.rs
│   ├── activate.rs
│   ├── update.rs
│   ├── rollback.rs
│   ├── quarantine.rs
│   ├── remove.rs
│   └── recover.rs
└── ports/
    ├── packages.rs
    ├── trust.rs
    ├── data.rs
    ├── instances.rs
    └── persistence.rs
```

Add a separate plugin-host service only for a real approved executable isolation/lifecycle boundary; portable skills alone do not require a generic code host. No ordinary domain microservices.

Archive, schema, signing, scanning, host/WASM/UI libraries require exact dependency/version/license/security/privilege review under P0-06. Never auto-install packages declared by third-party manifests. Target production source under 300 lines; review above 400; require a documented exception above 600.

## 24. Conformance, adversarial, and failure tests

| Area | Required evidence |
| --- | --- |
| Portable manifest | Required/recognized schema; unknown root ignored/reported; non-object extensions exception; unimplemented namespace ignored; fatal types block |
| Components | Fixed paths; skill validation; MCP schema version match; invalid/unsupported entry affects exact components |
| Placeholders/env/cwd | Exact single-pass expansion; reserved case-equivalent variables rejected; root/data containment; no shell expansion |
| Archives/paths | Zip-slip/traversal/ADS/device/UNC; links/reparse/special files; collisions; bombs/count/depth/time/resource limits |
| Identity/trust | Same version/different bytes; forged author/key; signature mismatch; key rotation/revocation; scan unavailable not clean |
| Permissions | Install grants zero tools; named assignments; changed code/schema/endpoint requires review; badge cannot override deny |
| Package/data isolation | Immutable package writes denied; project/account instance data separation; no vault/DB/sibling access |
| Execution | No install hooks/main-renderer/native-core code; sandbox missing blocks; host/descendant termination and channel fencing |
| Declarative UI | Eval/remote embed/action injection blocked; source badges; shortcut collision; cannot impersonate trusted approval |
| Updates | Active version pin; no silent new permissions; side-by-side candidate; old/new incompatible data cannot share |
| Migrations/rollback | Staging copy; partial/unknown effect; downgrade incompatibility; revoked version cannot restore |
| Quarantine | New admission denied; grants/cache invalidated; bounded evidence; no malicious cleanup link |
| Removal | Active references/effects reconciled; personal forks/user files/memories preserved; scoped data preview |
| Recovery | Kill at placement/receipt/activation/migration/removal boundaries; replay no effects; pending consent not invented |
| Privacy | No credentials/private config/paths/data in events/logs/UI persistence; authorized exports with limits |
| Compatibility | Exact declared platform/client/protocol profile; unknown future extension blocked; no untested feature claim |

Use inert/malicious synthetic packages and sacrificial storage first. Independently test actual OS containment; a valid portable manifest or fake host cannot prove runtime security. Conformance fixtures cover normative nonfatal exceptions rather than an incorrectly strict all-or-nothing loader.

## 25. Implementation and acceptance gates

### G1 — Portable inert loader

- [ ]  Pinned schema/spec/conformance semantics and namespace behavior reviewed.
- [ ]  Safe snapshots/path/resource limits and component inventory pass adversarial tests.
- [ ]  Discovery/install executes zero third-party code.

### G2 — Trust and permission records

- [ ]  Content identity, publisher/signature profile, scan coverage, review tiers and unsigned-package rules accepted.
- [ ]  Install, assignment, auth, component enablement and execution remain separate decisions.

### G3 — Durable installation and scoped runtime

- [ ]  Immutable package/data separation, receipts/journals and crash reconciliation tested.
- [ ]  P0-13 skill/MCP restrictions and P0-09 effective sandbox requirements preserved.
- [ ]  Unsupported custom/native/UI surfaces remain disabled.

### G4 — Lifecycle controls

- [ ]  Updates/pins/data migration/rollback/disable/revoke/quarantine/uninstall semantics tested.
- [ ]  Revoked/deleted authority cannot reappear through restore or a stale binding.
- [ ]  Personal forks/unrelated data preserved; cleanup uncertainty visible.

### G5 — Evidence and integration

- [ ]  Registry/IPC/capability/generated-contract amendments reviewed.
- [ ]  Audit/license/privacy/native/fault/isolation/verification gates green for actual supported profile.
- [ ]  Evidence records exact digest/version/instances/platforms/permissions/assurance/limitations.

P0-14 completion validates the declared portable plugin lifecycle/profile—not arbitrary native extensions, marketplace safety, or universal compliance/security certification.

## 26. Stop conditions and P0 series handoff

Stop acquisition/activation/execution on unknown schema/publisher identity under the required policy, package containment/integrity violation, unreviewed authority changes, unsafe data migration, revoked content, missing effective sandbox, orphaned process, credential exposure, or unresolved lifecycle/effect journal.

Do not solve a blocker by trusting embedded keys, executing installer hooks, granting broad mounts/env/network, disabling scans, overwriting active pins/data, auto-rolling back incompatible schemas, or treating a signature as permission.

P0-14 closes the currently defined P0-01–P0-14 contract sequence. Before implementation or broader alpha claims, perform a cross-document consistency/decision audit: exact schemas/commands, stream/transaction ownership, platform containment, protection/key/deletion lifecycle, budgets, verification authority, dependency approval, and unresolved ADRs. Then execute the approved P0-06 foundation gates and subsequent implementation stages in order.

No new release, marketplace, automation, or P0-15 workflow is authorized by completing this specification. Planning documents being written is not evidence that the corresponding code/security gates have passed.