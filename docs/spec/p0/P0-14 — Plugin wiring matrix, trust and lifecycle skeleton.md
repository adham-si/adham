<aside>
📦

Companion to P0-14. Research matrix only — it authorizes no downloads, installation,
signatures, execution, publication, or purchases.

</aside>

# P0-14 — Plugin wiring matrix, trust and lifecycle skeleton

## 1. Purpose and boundaries

This document is the research companion to `P0-14 — Plugin package trust, isolated execution,
and lifecycle contract`. It answers one question: for each plugin integration point, which
settings and files must be wired, which trust evidence each decision needs, and which security
controls come first.

- **Status:** research only. It does not authorize downloads, installation, signatures/key
  creation, host changes, plugin execution, authentication, publication, purchases, or deletion
  of user data.
- **Scope:** portable package conformance (Agent Plugins 1.0.0), Adham trust/lifecycle
  (identity, review, immutable install, scoped data, isolation, updates, rollback, revocation),
  and the Tauri capability model that inspires Adham's permission design. Skills/MCP behavior
  stays P0-13; tool execution stays P0-09; verification stays P0-10.
- **Implementation order is unchanged (P0-14):** load a user-selected local package directory
  as inert content → validate and snapshot portable skills/MCP components via P0-13 → install
  immutable reviewed content into app-owned storage with no hooks → assign exact components to
  named scopes, disabled by default → explicitly reviewed update/disable/rollback/uninstall.
- **Out of first profile:** arbitrary custom UI, executable hooks, native libraries, WebAssembly
  components, marketplace purchases, online publisher registration, automatic update feeds, deep
  OS extensions.
- **Portable vs Adham rule:** publisher signatures, permission overlays, trust tiers, install
  receipts, catalog authorization, and revocation metadata are Adham client/distribution
  policies — never claimed as portable-standard fields.
- **Data hygiene:** all publisher names, keys, digests, and URLs here are synthetic placeholders.
  No real credentials, user content, or machine paths.
- **File-size note:** target under 600 lines; split per family (trust / lifecycle / isolation)
  before review if it grows past that.

## 2. Shared package and trust schema

Parsing, discovery, and installation are inert — no install/postinstall/activation script ever
executes automatically. Format conformance, content integrity, publisher identity, trust review,
and runtime authority are five separate dimensions.

### 2.1 Identity objects

| Object | Responsibility |
|---|---|
| `PackageArtifact` | Exact inert source/archive/snapshot bytes + provenance |
| `PortableManifestProfile` | Recognized format version + local normative validation rules |
| `PublisherIdentity` | Independently established source/key/organization identity + review status |
| `PackageVersionIdentity` | Publisher/package identity, declared version if present, exact content digest |
| `InstallReceipt` | Adham-owned immutable validation/trust/component inventory record |
| `PluginInstallation` | Reviewed package version registered locally, initially disabled |
| `PluginRuntimeInstance` | Scope/account/grant-bound execution + dedicated mutable data |
| `ComponentBinding` | Exact skill/MCP/declarative revision + permission profile |
| `LifecycleOperation` | Durable install/update/activation/migration/rollback/uninstall journal |

Backend IDs: `PackageId, PackageArtifactId, PublisherId, PluginInstallationId, PluginInstanceId,
InstallReceiptId, LifecycleOperationId, DataGeneration, RevocationGeneration`; reuse P0-13
skill/connection/binding identities and runtime/tool operation IDs. A version label alone is
never identity — same publisher/package/version with different bytes is a conflicting artifact
needing explicit review, never a silent replacement. Author email/homepage/repository is
descriptive provenance, not verified ownership.

### 2.2 Trust dimensions and tiers

Recorded separately per package version: source/publisher identity (verified / unverified /
disputed); content digest integrity; signature status + signer authorization; scan
results/coverage/version; manual review status + exact reviewed components; organization
approval + exact scopes; runtime containment profile. Displayed tiers — `Unverified`,
`Community verified`, `Adham reviewed`, `Organization approved` — require defined evidence
before display; never derive a badge from install success or download count (download pumping
is a known inflation tactic). Organization approval cannot override hard safety gates. Unsigned
local/community packages may earn restricted enablement with strong warning + current policy
approval, but never unavailable sandbox profiles, broad credentials, or automatic updates.

### 2.3 Signature and scan profile

The signature envelope (algorithm, trust root, signed payload = publisher/package/version +
canonical content manifest, key distribution/rotation/revocation, expiry/freshness, offline
verification) is an Adham distribution ADR. Signature files cannot authorize themselves; an
embedded public key is never automatically trusted. Verify against approved keys and exact
content before activation — a compromised authorized signer can still sign malware, so
sandbox/permission review stays mandatory. Reference model: Tauri updater signing (offline key
generation, public key pinned in config, private key never shared, loss = no further updates;
verification cannot be disabled). Scan scripts/binaries/manifests for malicious patterns, secret
exposure, vulnerable dependencies, unsafe commands, excessive permissions, prompt-injection
indicators — with documented coverage limits. Missing scanners or unsupported binaries are
`unknown` evidence, never a clean result.

## 3. Package wiring matrix

Conventions mirror the provider/MCP matrices: each record binds exact bytes, exact identities,
and exact scopes. Nothing crosses a boundary on a friendly name.

### 3.1 Portable layout and manifest (Agent Plugins 1.0.0)

```
package/
├── plugin.json                 # required: $schema (canonical, local) + name
├── skills/<skill>/             # SKILL.md + scripts/ + references/ + assets/
├── mcp.json                    # mcpServers: stdio command/cwd, plugin-relative paths only
├── si.adham.desktop/           # Adham-owned files (namespace directory)
├── README.md / LICENSE / CHANGELOG.md
```

Manifest rules (Context7 `/websites/agent-plugins`): `$schema` must be the recognized canonical
identifier and selects local rules — never downloads schema/code during load. `name` is
constrained (`[a-z0-9.-]`, no `--`/dots abuse). `extensions` holds client data keyed by
reverse-domain namespace; the portable spec assigns no semantics to namespace contents.
Parser rejects duplicate keys/type/size/depth violations; unknown top-level fields and
non-object `extensions` are reported/ignored (nonfatal); unimplemented namespaces are ignored
semantically without remote loading — but generic path/security scanning still covers all bytes.
`command: ./bin/server` is valid, `../bin/server` is not (containment failure = security
failure, quarantine without running). A manifest says nothing about publisher, signing,
permissions, or safe execution.

### 3.2 Adham namespace (`si.adham.desktop`)

Adham-only manifest data goes under `extensions.si.adham.desktop`; files under the matching
top-level directory. Never add permission/runtime/UI semantics to portable root fields. Adham
extension validation is independent of portable conformance: unsupported contribution types stay
inert/disabled with explicit reason, and one invalid UI contribution must not change skill/MCP
grants or conceal a security violation (fatal vs component-scoped failure, defined per schema).
First closed contribution schema covers inert labels/settings descriptions, reviewed template
references, and actions mapped to existing trusted canonical commands only: versioned schema,
bounded strings/collections, no JS/`eval`, no HTML handlers, no remote embeds, no CSS
injection, no executable template hooks, no automatic fetch; action IDs namespaced to exact
instance/version; source badge + permission requirements + disabled states; no shortcut
collisions or settings-policy edits; command selection is a policy-routed proposal, never raw
IPC. A plugin can never render an approval screen impersonating the trusted permission broker.

### 3.3 Acquisition and safe extraction

Local directory loading needs explicit authorized selection, broker-resolved identity, and an
immutable snapshot — a mutable source never becomes trusted production content by passing
validation once. Archive/network acquisition is a separately gated profile: approve
source/origin, TLS/proxy/redirect policy, download size, trust metadata; no model-controlled
authenticated endpoints or auto-open; stage only into validated app-owned handles; enforce
compressed/unpacked bytes, file count, depth, ratio, wall time (P0-14's suggested initial
profile, not yet normative: 50 MiB down / 200 MiB unpacked / 5,000 files / depth 16 /
ratio 100:1 / 60 s; any change needs explicit resource/security review); reject
absolute/traversal/drive/device/UNC/ADS paths, symlinks/hardlinks/reparse/special files, case
collisions, duplicate entries, Windows reserved names; never execute extracted files or follow
package URLs; safe permissions (no preserved setuid/executable/ACL authority); verify final
object identities/manifest, not archive headers alone.

### 3.4 Permission overlay and installation review

Build a protected Adham `PermissionReview` bound to exact digest/version + component revisions,
showing: inert skills/resources/scripts; MCP binaries/transports/accounts/tools (disabled by
default); exact filesystem needs; network destinations/proxy/retention disclosures; credential
references/scopes + child-process visibility; storage/resource limits; background execution;
contribution support status; requested assignments; unverified capabilities + residual risk.
Never infer permissions from README/marketing. A server that downloads dependencies at startup
stays blocked until a separate reviewed provisioning workflow. The user selects components and
scopes; install consent approves storage/registration only — not execution, authentication,
tools, cloud transfer, memory, or live-project writes. Component grants are P0-09/P0-13
policies; plugins cannot request future tools or rewrite their own approval rules.

### 3.5 Immutable install, activation, and isolation

App-owned layout (platform-resolved): `plugins/packages/<opaque>/<version>/`,
`instances/<opaque>/data/<generation>/`, `staging/<operation-id>/`, `receipts/`,
`quarantine/<artifact-id>/`. Package bytes immutable/read-only; untrusted processes cannot
write package bytes, other instances' data, receipts, policy records, or vault/DB. Shared
read-only bytes may serve several instances; writable data partitions by project/account/grant.
Subprocesses get client-owned `PLUGIN_ROOT`/`PLUGIN_DATA` at sandbox-visible resolved
locations; single-pass variable expansion in supported fields only; spec-valid `cwd` is not
host-home permission — containment comes from the sandbox.

Install transaction (10 ordered steps): authorize inert acquisition + journal intent → stage and
snapshot bytes → validate portable/components/namespace/security/resources → verify
source/content/signature/scans → record inventory + obtain review → prepare immutable location +
scoped data metadata → journal placement + validate final identity → atomically register
installed-disabled state + receipt + bindings + projections → reconcile ambiguity → enable
selected components only through separate grants. No package hooks execute; rename-vs-SQLite is
two boundaries with crash recovery for orphans. Activation rechecks digest, identities, policy/
trust/revocation generations, revisions, sandbox support, grants, run pins; corruption
quarantines, never self-repairs.

Runtime isolation by class: skill instructions/assets → protected context + brokered reads;
skill scripts → P0-09 sandbox with exact snapshot/grant; local MCP → scoped sandbox + private
stdio; remote MCP → approved HTTPS/account/protocol binding; declarative UI → trusted renderer
over closed inert schema; custom UI / WASM / native → deferred behind isolated-origin,
strict-CSP, narrow-bridge, fuel/IO-limit contracts. Separate process ≠ containment; no dynamic
library injection, no renderer Node execution, no arbitrary React imports, no host DOM mutation,
no Tauri command access for third-party code — signing never exempts in-process loading.
Unsupported profile disables visibly; never launch unsandboxed for marketplace compatibility.

### 3.6 Updates, migration, rollback, revocation

No silent auto-update/activation: the user reviews exact candidate version/artifact + diff.
Comparison covers publisher/key/content identity, schemas, skill bodies/scripts, MCP
endpoints/binaries/auth/protocol/tool schemas, dependencies, migrations, network/filesystem/
credential/background deltas — not just the version string. New or materially changed authority
needs approval; changed code can invalidate review; new MCP tools arrive disabled. Active runs
pin snapshots; updates wait for pause/settle; side-by-side disabled candidate → verify →
migrate data in staging → atomically switch binding → activate permitted components.
Migration is untrusted code until reviewed (or blocked when no validated mechanism exists);
rollback needs a reviewed nonrevoked earlier package + compatible data generation — never point
an old binary at an irreversibly upgraded DB or restore stale grants. Signer/publisher changes
need continuity review from trusted evidence; package-supplied “new key” text authorizes
nothing. Revocation overrides pins and standing grants for new admission; active work stops and
reconciles safely.

### 3.7 Tauri capability mapping (design reference, not dependency)

Tauri 2 replaced the v1 allowlist with permissions (command on/off toggles) + scopes (parameter
validation) + capabilities (attach permissions/scopes to windows/webviews) — per-window,
per-domain ACL in `src-tauri/capabilities`, with plugin authors shipping secure-by-default
permission sets apps can extend or reduce. Adham mirrors this shape: default-deny commands,
named permission sets per component, scope-bound grants, per-window/surface attachment. Update
trust mirrors Tauri's updater: mandatory signature verification, pinned public key, offline
private key, no silent downgrade path.

## 4. Security-first controls

A valid signature, marketplace badge, or successful install is not permission to execute and
not proof of safety. Badges, scans, and signatures never replace sandbox/policy/verification
evidence.

1. **Inert until granted.** Discovery/installation/registration execute nothing. Install consent
   covers storage only; every component starts disabled; activation re-verifies everything.
2. **Identity before trust.** Exact digest + publisher + version + revision pins before any
   review; same-name artifacts never substitute (Orca bait-and-switch class: benign skill passes
   scan, repo mutated post-scan while clean results still display; silent same-name overwrite
   with no diff or warning).
3. **No self-authorization.** Plugins cannot request future tools, rewrite approval rules,
   inherit broader permissions on update, or approve their own migration. New authority always
   re-approves.
4. **Treat content as hostile.** Skill bodies, scripts, descriptions, and instructions carry
   prompt-injection and malware at once (Snyk: 100% of confirmed-malicious skills ship malicious
   code, 91% add prompt injection; ESET 2026: 800k skills scanned, 25k suspicious, 2.5k
   malicious; ClawHub ClawHavoc: 1,184 malicious skills incl. Atomic macOS Stealer).
   Metadata-only attacks bias discovery 86% pairwise and evade scanners up to 100% — scanning
   is `unknown`-bounded evidence, never a clean bill.
5. **Kill the install-time RCE path.** No preinstall/postinstall hooks, no dependency
   download at startup, no `binding.gyp`-class build execution, no `npx`/`uvx` implicit fetch
   (npm `is` 2.8M-download compromise; `ambar-src` 50k-download preinstall RAT; Shai-Hulud
   Miasma 281 versions via build-time execution; `ethers-provider2` backdooring installed
   ethers files so uninstall doesn't clean).
6. **Brandjacking resistance.** Names/icons/descriptions prove nothing; verify publisher
   identity independently (fake `prettier-vscode-plus`; `finch-rust` loader; TigerJack's 11
   extensions / 17k installs; 70+ GlassWorm sleeper clones; download pumping inflates trust
   signals).
7. **Secret hygiene.** Scan for leaked tokens in packages (Wiz: 550+ validated secrets across
   500+ VS extensions, 85k installs exposed); never import plaintext secrets; child-visible
   secrets disclosed as residual risk. Maintainer-token theft turns trusted packages into
   delivery (Open VSX registry-takeover flaw; Solana-blockchain-C2 GlassWorm harvesting npm/
   GitHub creds to infect further extensions; GitHub's 3,800-repo breach via trojanized Nx
   Console after the TanStack npm compromise).
8. **Update path is attack path.** Sleeper extensions ship clean then weaponize through normal
   updates (GlassWorm); diffs are mandatory, auto-updates forbidden, old versions never inherit
   new authority. Registry compromise = total marketplace control (Open VSX `OVSX_PAT` flaw).
9. **Data-theft defaults denied.** Exfiltration-shaped behaviors (whole-file reads on open,
   50-file harvest commands, hidden tracking iframes — MaliciousCorgi 1.5M installs) map to
   explicit filesystem/network/retention disclosures in `PermissionReview`, default-deny.
10. **Prompt-to-shell chains broken.** Tool exposure + file placement + download primitives must
    never compose into host RCE (Microsoft Semantic Kernel prompt→`calc.exe` chain; fix was
    removing AI visibility of the dangerous function — Adham equivalent: dangerous operations
    have no tool identity at all).
11. **Multi-decade maintainer caution.** Long-trust social engineering backdoors core
    dependencies (XZ Utils). Prefer verified publishers with security policies, review source,
    subscribe to advisories, keep an explicit allowlist with quarantine + revocation + rollback
    that actually work offline.

## 5. Lifecycle skeleton, risk log, sources, and open decisions

### 5.1 Skeleton (names only — no code authorized)

```
crates/adham-extensions/src/
├── lib.rs                 # Public API only
├── plugins/
│   ├── mod.rs             # PackageId, InstallReceipt, PluginInstallation, LifecycleOperation
│   ├── acquire.rs         # Local selection snapshot; archive staging bounds (§3.3)
│   ├── validate.rs        # Pinned schema bytes, manifest rules, component inventory
│   ├── trust.rs           # Publisher identity, signature profile, scan evidence, tiers
│   ├── review.rs          # PermissionReview binding digest/version/revisions
│   ├── install.rs         # Immutable placement, atomic registration, orphan recovery
│   ├── lifecycle.rs       # Enable/disable/update/rollback/uninstall journals
│   ├── revoke.rs          # Revocation generations, quarantine, removal-pending
│   └── contributions.rs   # si.adham.desktop closed-schema validation
└── (skills/ + mcp/ per the P0-13 matrix doc)
```

`src-tauri/capabilities/` ships `core:default`-only for the slice; every new command/surface
adds an explicit capability file, never a generic executor. Frontend surface: package list
(identity + tier + health), review screen (components, scopes, destinations, residual risk),
per-component enable toggles, quarantine/revocation states. Typed commands:
`list_plugin_packages`, `preview_plugin_import`, `install_plugin_package` (storage only),
`set_plugin_component_grant`, `revoke_plugin_package`, `rollback_plugin_package`. DTOs via
`ts-rs`, committed, CI drift-checked, Zod-validated at the boundary.

### 5.2 Risk log (signal → Adham rule)

| # | Signal | Adham rule |
|---|---|---|
| P1 | Fake Prettier / TigerJack / GlassWorm clones / download pumping | §4.6: publisher verification, no trust from names/counts/badges |
| P2 | Wiz 550 leaked secrets in extensions | §4.7: secret scanning, no plaintext imports |
| P3 | GlassWorm self-spreading via stolen creds + blockchain C2 | §4.7: scoped tokens, allowlist, revocation that works |
| P4 | MaliciousCorgi 1.5M-install exfiltration | §4.9: explicit data/network disclosures, default-deny |
| P5 | GitHub 3,800-repo breach via Nx Console / TanStack chain | §4.7: maintainer-token awareness, update diffs, no silent activation |
| P6 | Open VSX registry-takeover flaw | §4.8: registry distrust, local verification, no auto-trust of feeds |
| P7 | npm preinstall RATs / `is` / Shai-Hulud build-time exec | §4.5: no hooks, no startup downloads, no build execution |
| P8 | `ethers-provider2` persistent backdoor past uninstall | §3.5–3.6: immutable packages, verified rollback, generation-scoped data |
| P9 | XZ maintainer-trust backdoor | §4.11: verified publishers, source review, advisory subscriptions |
| P10 | ClawHub 1,184 malicious skills / AMOS stealer | §4.4: content-hostile scanning with documented limits, quarantine |
| P11 | Bait-and-switch post-scan mutation / silent overwrite | §4.2: digest pinning, diffed updates, no auto-update |
| P12 | Metadata-only discovery attacks (86% win rate, 0% scanner detection) | §4.4: descriptions as routing data, human review for grants |
| P13 | Semantic Kernel prompt→RCE chain | §4.10: dangerous operations have no tool identity |

### 5.3 Sources

- Context7: `/websites/agent-plugins` (layout, `plugin.json` schema, `mcp.json` stdio
  command/cwd rules, reverse-domain `extensions` + namespace directories);
  `/tauri-apps/tauri-docs` (permissions/scopes/capabilities ACL, per-window attachment,
  secure-by-default plugin permission sets; updater mandatory signing, key generation,
  pinned pubkey, private-key custody).
- Live channels (`agent-reach doctor` 4/16 verified earlier: V2EX, RSS, Jina Reader,
  Bilibili-search; GitHub/YouTube/Exa + 9 login channels unavailable).
- Web: Hunt.io fake-Prettier RAT; Wiz VS-marketplace secrets + takeover; Koi TigerJack +
  MaliciousCorgi + BigBlack stealer; GlassWorm waves (Koi, Socket, SecurityWeek, InfoWorld);
  Open VSX `OVSX_PAT` flaw; GitHub Nx Console/TanStack breach + CSA 18-minute analysis;
  ReversingLabs `ethers-provider2`; Tenable `ambar-src`; Sonatype Shai-Hulud Miasma;
  CISA XZ lessons; Snyk ToxicSkills (3,984 skills, 76 malicious); CSA poisoned-skills
  (ClawHavoc 1,184, AMOS); SkillSieve triage; Orca bait-and-switch/nested-injection;
  Microsoft Semantic Kernel RCE; ESET 800k-skill scan; skills-security-audit patterns.
- Repo: `P0-14 — Plugin package trust…:1-340` (conformance, acquisition bounds, validation,
  trust tiers, permission overlay, immutable layout, install transaction, isolation table,
  declarative schema, custom-UI gate, updates, migration); `P0-13 …:1-200`;
  `P0-09 …:1-80`.

### 5.4 Open decisions (human-gated, unchanged)

Same six: Apache-2.0 license (no placeholder); Node 24 LTS; `ts-rs` for P0 IPC DTOs; manual
Vite + `pnpm tauri init`; domain-command boundary; dependency-set approval before any install.
Plus P0-14's own gates: signature-envelope ADR, trust-tier evidence definitions, sandbox
profiles per component class.

This matrix authorizes nothing: no downloads, installs, signatures, execution, publication,
purchases, or data deletion.
