<aside>
🧰

Discover capabilities lazily; authorize them individually. A skill teaches a workflow but cannot grant tools. An MCP server exposes a protocol but is not trusted merely because it authenticated or runs locally. All execution remains behind Adham’s scoped policy, budget, sandbox, and verification gates.

</aside>

## Purpose and implementation boundary

Specify Agent Skill ingestion/identity, progressive loading, routing and activation, supporting-resource containment, MCP connection/protocol/authentication identity, individually enabled tools, schema/result validation, lifecycle/revocation, and runtime/memory/subagent integration.

Initial implementation:

1. Reviewed local skill snapshots with metadata discovery and lazy instruction/resource loading.
2. One sandboxed local stdio MCP fixture with synthetic, bounded tools.
3. One separately approved HTTPS Streamable HTTP connection proving identity/auth/grant and isolation boundaries.
4. Production capability enablement only for the validated subset.

Reading this document does not authorize installing skills, launching MCP servers, authenticating accounts, importing configurations, invoking remote tools, or exposing additional IPC commands.

Excluded initially: plugin package installation/update machinery, arbitrary UI extensions, legacy HTTP+SSE, unconstrained network-enabled local servers, server-requested model sampling/elicitation, automatic resource subscriptions, hosted code/UI execution, autonomous capability installation, and generic cross-project tool access.

### Governing Adham specifications

- P0-09 — Tools, policy, and sandbox execution contract.
- P0-10 — Verification gate and evidence-backed completion contract.
- P0-11 — Task graph and isolated subagent execution contract.
- P0-12 — Governed local memory contract.
- P0-08 — Provider gateway and normalized stream contract.
- P0-07 — Agent runtime state machine.
- P0-04 — Typed IPC, capabilities & frontend sync.
- Architecture — Global and project file paths.
- Architecture — Plugin system.

## 1. Standards baseline and version discipline

Agent Skills defines SKILL.md with YAML frontmatter and Markdown instructions, optional scripts/references/assets, and progressive disclosure from metadata to full instructions to needed resources. The allowed-tools field is experimental and implementation support varies.[[1]](https://agentskills.io/specification)

Adham adopts the skill format while enforcing its own authority model: allowed-tools is a declared constraint/request evaluated against existing grants, never authority supplied by the skill itself. This interpretation must be documented in compatibility behavior rather than silently importing another client’s preapproval semantics.

MCP defines stdio and Streamable HTTP transports. The inspected 2026-07-28 revision uses per-request version/capability metadata and differs from 2025-11-25-and-earlier initialization/session semantics. Adham must pin supported protocol profiles and their actual schemas/SDK behavior; it must not blend both eras into one assumed handshake.[[2]](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)[[3]](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)

MCP tool annotations are not trustworthy safety evidence by default; input/output schemas and error/result semantics require validation. A server saying read-only or idempotent does not independently prove those effects.[[4]](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

MCP authorization/security guidance covers resource-bound tokens, issuer validation, OAuth discovery, confused-deputy/token-passthrough risks, SSRF, local server compromise, and state-handle theft. Adham’s connection/auth implementation must apply the requirements of its selected revision and tested account profile.[[5]](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)[[6]](https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices)

**Protocol decision gate:** select and record one initial supported revision/SDK pair after compatibility/security review. Legacy-era support, modern-era support, or dual-era support is a deliberate tested matrix—not automatic universal compatibility. Unsupported versions fail with a safe actionable message. Any fallback changes only approved protocol mechanics, never endpoint/account, privacy, or grants. Never replay a potentially side-effecting tool call to probe compatibility.

## 2. Core invariants

1. Installation, discovery, workspace/project assignment, activation, schema loading, and execution are separate permissions/states.
2. Models/skills/servers cannot install, enable, authorize, or change their own capabilities.
3. Tool lists/descriptions/results, skill frontmatter/body, imported configs, and referenced resources are untrusted inputs.
4. Stable identity includes source/owner/version/connection binding; a friendly name is never unique authority.
5. Only approved scoped candidates enter model discovery context; unauthorized capability names/counts are not exposed.
6. Skill activation never bypasses P0-09 exact-action policy or sandbox requirements.
7. MCP tools start disabled individually; authenticating a connection enables no tools by itself.
8. Server/account/endpoint/schema/implementation changes invalidate affected grants and pinned contexts.
9. Credentials are vault/broker-owned and never appear in prompts, exports, event payloads, or renderer state.
10. A transport request ID is not proof of remote idempotency or exactly-once effects.
11. MCP cancellation/reconnect cannot imply rollback or authorize blind retries of uncertain calls.
12. Resource links, schemas, prompts, and returned URLs cannot cause arbitrary file/network loads automatically.
13. Child sessions receive explicit capability subsets and pinned identities; no ambient manager inheritance.
14. Remembering results requires a separate P0-12 proposal/grant; installed capabilities get no memory access automatically.
15. Tool success/skill completion cannot bypass P0-10 evidence-backed task verification.

## 3. Registry and stable capability identities

### Skill identity

Canonical identity binds source kind, owner, SkillId, immutable revision/content snapshot, provenance, trust/review state, and assignment scope.

Examples are identity shapes, not actual installed packages:

```
user:<owner-id>/<skill-id>@<revision>
workspace:<workspace-id>/<skill-id>@<revision>
project:<project-id>/<skill-id>@<revision>
plugin:<publisher>/<package>/<skill-id>@<package-version>
```

Identical friendly names coexist. A personal skill cannot replace a plugin-bundled skill by name; a pinned workflow resolves exact canonical identity. Disabled/uninstalled dependencies become needs-configuration, not a silently selected same-named substitute.

### MCP identity

McpConnectionId binds ServerBindingId, service kind, endpoint or reviewed executable snapshot, authorized account/credential references, protocol profile, configuration revision, and grants.

Canonical tool identity includes connection binding, server generation, exact tool name, schema/behavior revision, and reviewed policy profile. Provider/model-generated names map only to current enabled registry entries; collisions require explicit identity resolution.

The remote server’s name/version/self-description is evidence for display/protocol compatibility, not authenticated publisher identity. TLS/account authorization prove only their specific boundaries; remote implementation changes may not be fully observable. Record that limitation.

## 4. Skill discovery and snapshot ingestion

Support user-selected skill roots, project .agents/skills/, and reviewed plugin component references. Do not scan the entire disk/home or write a branded folder into every project. Known client-specific locations require an explicit import preview; do not claim all products share the same path.

Discovery:

1. Use an authorized root capability and bounded directory enumeration.
2. Validate file/object identities and reject path escapes, links/reparse points, special objects, unsafe encodings, and oversized trees.
3. Parse frontmatter safely with schema/duplicate-key/alias/depth limits; no YAML object execution.
4. Validate required name/description and compatibility declarations against the selected Agent Skills profile.
5. Capture an immutable protected/reviewed content snapshot and source/version provenance.
6. Record scripts/resources as inert files—never execute on discovery.
7. Quarantine invalid/suspicious packages and show reasons without loading their instructions into privileged context.

A local mutable source is not an immutable installed version. Pin a reviewed snapshot for each run; source changes create a new candidate revision and invalidate review where applicable. Never silently hot-reload active skill instructions/scripts.

Descriptions themselves can contain prompt injection. Treat them as routing data with explicit boundaries, not system instructions. Do not fetch remote icons/license/schema URLs just to render metadata.

## 5. Progressive loading and context budgets

Adham follows three stages:

- metadata discovery: short authorized names/descriptions/source/compatibility summaries;
- activation: full reviewed SKILL.md body for selected skills;
- resources: only referenced files needed for the current phase.

At scale, registry search retrieves a bounded metadata shortlist rather than inserting all installed skills into every prompt. This is Adham’s context-budget policy; document its behavior relative to the standard’s progressive-disclosure guidance.

Default initial bounds:

| Limit | Baseline |
| --- | --- |
| Skill metadata shortlist | 20 candidates maximum |
| Primary active skill | 1 per task phase |
| Additional active helper skills | 2, only when explicitly useful/compatible |
| SKILL.md payload | 64 KiB maximum; token-budget fit still required |
| Supporting text resource | 256 KiB per load |
| Resource loads per activation | 10 by default, bounded cumulative 1 MiB |
| Referenced traversal depth | 2 maximum, cycle detection |
| Total skill instruction token budget | Explicit slice of authorized context budget, not unlimited |

A valid but too-large skill is unavailable for the current budget until split or reviewed; do not silently truncate mandatory instructions and claim the skill was followed. Loading failure blocks activation instead of relying on metadata alone.

Resource references are relative to pinned skill root and broker-resolved. Reject traversal/absolute/ADS/device forms and remote auto-fetch. Binary assets require typed bounded artifact handling, not arbitrary inline decoding into context.

## 6. Skill routing, activation, and conflict handling

Routing order:

1. User-selected exact skill, if available/authorized.
2. Exact skill pinned to addressed agent/workflow.
3. Project preference for intent.
4. Workspace preference.
5. Bounded router selection by description, compatibility, trust/review, required authority, expected cost, and known quality.

Explicit selection cannot override policy or unavailable dependencies. If materially different equally plausible skills remain, request a compact choice; do not silently shadow by short name. Low-risk automatic selection must expose the chosen source/revision.

Activation creates a protected ActivationManifest: task/run/phase, canonical identity/revision, instruction/resource snapshot references, routing reason, compatibility, required tool bindings, authority ceiling, and context budget.

When skills conflict, preserve hard policy/project authoritative constraints and surface workflow conflict; do not concatenate instructions hoping the model resolves security semantics. A skill cannot override locked sources, verification, consent, or scope.

Phase transitions release no-longer-needed instructions and record new activation; canonical history remains intact. Cancellation/deactivation stops new resource/tool admission but does not undo completed effects.

## 7. Skill scripts and tool declarations

Scripts are executable untrusted code. Reading a script is not permission to run it.

Execution requires:

- exact pinned script/content/interpreter identity;
- P0-09 normalized action, reviewed argv/environment, target/staging scope;
- current grants/approval and validated sandbox/profile;
- bounded resources/output/artifacts and effect reconciliation;
- no ambient credentials/network, live-project writes, or package installation by convenience.

allowed-tools cannot name arbitrary native endpoints or grant shell wildcards. Map reviewed declarations to existing canonical tool identities, intersect with current task/grants, and fail unsupported mappings. Skill-supplied preapproval language is not a human approval record.

A script instruction to install missing dependencies, call a remote API, delete files, or run an unsafe command creates a proposal requiring its own contract/authority. If unavailable, report blocked rather than bypassing the skill via unrestricted terminal execution.

## 8. MCP connection setup and imported configuration

Connection states: proposed → reviewed → configured-disabled → connecting → discovery-ready → active-for-selected-tools; unhealthy, suspended, auth-required, revoked, and quarantined remain distinct.

Imported .mcp.json/.vscode/mcp.json/.cursor/mcp.json or plugin mcp.json configurations are untrusted inputs. Show source, executable/endpoint, environment/header references, requested destinations/scopes, possible code execution, and intended project/account assignment.

Never import plaintext secrets into ordinary config or project files. Offer vault-backed migration using private input, with no echo into logs/prompts; finding a secret does not authorize using it. Never rewrite another client’s config without explicit export authority.

Command imports are structured executable/argv—not shell strings. Reject or require a separate reviewed transformation for implicit npx/uvx/download-on-start/install commands; connecting is not authority to fetch/execute unpinned code.

Launching a local server is itself arbitrary code execution even before tools are enabled. Require P0-09 sandbox/installation/binary authority for startup and discovery; disabled tools do not contain an unconstrained server process.

Remote discovery/auth requests expose endpoint/account/client metadata and may contact third parties. They require an explicit connection operation but send no project prompt/files by default.

## 9. Local stdio server isolation

Initial stdio proof uses an installed pinned synthetic server, private pipes, and a validated sandbox. No exposed unauthenticated localhost bridge or generic renderer-driven subprocess spawn service.

- Separate instance per immutable project/account/grant binding by default.
- Minimal executable/runtime resources and dedicated bounded server scratch/data.
- No user home, Adham DB/vault, Docker socket, SSH agent, inherited network sockets, or sibling state.
- Read-only approved snapshots/resources only when a tool’s reviewed contract requires them.
- Offline initial profile; network-enabled local MCP requires a later validated egress/credential profile.
- stdout is protocol only; stderr is bounded protected diagnostics, not control messages.
- Framing/type/request correlation/progress/cancellation behavior follows pinned protocol revision.
- Descendant lifetime/resource/cancel/recovery follows P0-09; connection loss triggers fail-closed containment.

Protocol guidance allows environment-based credentials for stdio rather than HTTP OAuth. Adham does not inject the entire environment or provider vault: a future server-specific credential reference may be resolved only under explicit narrow authority, with disclosure that the process can observe its injected secret. Initial offline fixture receives no secret. Credential brokerage cannot magically prevent a third-party process from reading a secret it must directly receive.

## 10. Remote Streamable HTTP endpoint boundary

Use reviewed HTTPS origin/path and service/account identity. Validate TLS, actual resolved destination/network class, proxies, redirects, discovery/auth URLs, and response size; reuse P0-08 network-security principles through a shared trusted adapter, not a credential-bearing generic HTTP endpoint.

Custom/private company endpoints need explicit network-class trust and grants. A public remote endpoint must not silently resolve into loopback/private/link-local/cloud metadata services. OAuth/discovery endpoints are also untrusted URLs and require SSRF/scheme/issuer validation; discovery is not an arbitrary-fetch exemption.

No remote HTML/code/icons/resource links are executed/fetched automatically. Server-returned endpoints are reviewed against the configured origin/auth flow; no token forwarding through redirects.

Adham cannot sandbox a remote server’s internal implementation. Tool-level policy limits what it asks and sends, but cannot prove the server honors every asserted read-only scope. Review remote account scopes, service assurance, data policy, and residual risk; disable tools whose promised containment cannot be established for the selected task.

Protocol connection/request state remains distinct from Adham project/session identity. If selected legacy profiles use server-assigned session IDs, bind them to exact server/account/project/epoch and protect them; for modern profiles, validate returned application state handles under the same binding. Neither is authorization by itself.

## 11. Authentication and secret lifecycle

Support only separately tested profiles: selected-revision HTTP OAuth, preconfigured bearer-token/custom-header connections where appropriate, and narrowly scoped stdio credential references.

OAuth requirements include:

- pinned validated resource/issuer metadata and permitted authorization/token endpoints;
- selected-revision client registration policy and exact redirect/callback handling;
- PKCE and callback/issuer/state protections applicable to the selected profile;
- least-privilege scope review, explicit user approval for broad/new scopes;
- resource/audience-bound tokens; no token passthrough between unrelated services;
- vault storage for access/refresh tokens, expiry/refresh single-flight behavior, and revocation;
- protected flow records and safe failures without logging codes/verifiers/tokens.

A server-provided scope challenge is untrusted guidance, not automatic authorization to request all scopes. If normative protocol fallback suggests broader scope, pause for explicit review or block rather than silently requesting broad access. Record compatibility limitations honestly.

Auth URLs use validated schemes/origins; never open javascript/file/custom unsafe commands from server metadata. Authentication occurs in a safe approved browser/callback path without granting that web content the main desktop IPC authority.

Refresh/reauthentication does not expand tool grants. Account/issuer/resource changes create new identity review and invalidate affected caches/approvals. OAuth success proves authentication/consent scope, not trustworthy tool behavior or project isolation at the server.

## 12. Protocol profiles and optional capabilities

Maintain checked-in protocol schema/profile definitions and fixtures for every supported revision. Record SDK exact version, supported methods, parser/transport behavior, security patches, and compatibility limitations.

- Legacy-era initialization/version/capability exchange is implemented only for its selected revisions.
- Modern-era per-request metadata/discovery is implemented only with its reviewed schemas.
- Do not infer modern support from a generic error and retry a business operation under a different era.
- Probe/compatibility decisions use bounded non-effect discovery operations; security/auth failures never downgrade transport/TLS/permissions.
- JSON-RPC IDs correlate transport requests; internally stable OperationId and AttemptId govern effect recovery.

Disabled by default: sampling, elicitation, prompts, resources, roots advertisement, subscriptions, external UI extensions, notifications that request effects, and server-driven context expansion. Implement only the capability subset explicitly approved/tested.

MCP roots are protocol context hints, not filesystem enforcement. Do not advertise host roots automatically. If enabled later, expose only an approved representation with explicit path/privacy consent; sandbox/handle grants remain the actual boundary.

Server requests for user secrets, extra model calls, browser opening, or memory access cannot bypass normal private-input/policy/provider/memory paths. Unadvertised/unsupported requests receive a controlled protocol response; no silent execution.

## 13. Tool discovery, schema loading, and enablement

Discovery may enumerate tools only after connection/startup authorization. All tools start disabled even if the account has broad API scopes.

For each tool capture exact name, input/output schemas, descriptions/annotations, server/account/config generation, and content/behavior fingerprints in protected metadata.

- Validate schemas against the pinned protocol’s supported dialect and bounded complexity.
- No remote $ref fetching, recursive unbounded references, regex bombs, arbitrary format callbacks, or executable validation hooks.
- Unsupported schema semantics block tool enablement; do not pretend validation was complete.
- Descriptions/annotations are routing/display data, not policy instructions.
- Review actual read/write/destructive/open-world/idempotency effect profile separately; default unknown to high-risk/blocked.
- Tool argument-to-HTTP-header mappings, where a protocol profile supports them, require explicit reviewed allowlisting and header-injection/secret/origin checks. Server schema annotations alone cannot add auth/host headers.
- Enable an exact tool/schema revision for named scopes/principals with bounded standing or ask-before-side-effect policy.

Tools/list changes or refreshed discovery invalidate cached enabled bindings where identity/schema/effect materially changes. New tools stay disabled. A same-named tool whose schema/behavior changed requires review; unchanged names do not preserve authority.

Connection health is not tool health. Health checks use non-effect operations and cannot send real project content or invoke a paid/write tool merely to show green status.

## 14. Model-visible capability routing

Use a bounded capability registry search across permitted skills/tools. Load full schemas only for a small enabled selected set satisfying task purpose, provider capability, trust, privacy, and context budget.

Suggested initial model tool shortlist: 8 exact enabled tools; metadata candidates maximum 20. Exceeding schema/token budget requires narrowing selection, not truncating required schema fields.

Record a CapabilityContextManifest with skill activation, canonical tool bindings/schema generations, scope/grants/policy, provider/model snapshot, and context budget. It is protected and reconstructable.

A model’s proposed tool call must resolve to that exact current binding and pass P0-09 normalization. Hidden/unlisted/disabled names, collisions, stale schema revisions, and changed connection identities are rejected. Do not fall back to a similarly named tool or direct REST call.

Capabilities cannot route themselves solely through descriptions like “always use me.” Maintain adversarial routing fixtures and expose selected source/tools so the user can correct misrouting.

## 15. MCP invocation through the tool contract

```
model ToolProposal
→ exact enabled MCP binding/schema validation
→ trusted effect classification and scoped NormalizedAction
→ current policy / exact approval
→ budget and dispatch intent
→ bound MCP transport call
→ bounded untrusted result normalization
→ effect reconciliation/postcondition evidence
→ runtime observation / verification
```

Map MCP errors distinctly: protocol/auth/transport failure versus tool execution result with isError. A JSON-RPC success envelope or isError=false does not prove application postconditions or task completion.

Validate structuredContent against declared supported output schema where present. Plain text and structured content may disagree; preserve contradiction and block affected success claims. Unknown modalities/links are artifacts/proposals, not automatic fetch/open/execute operations.

Remote side-effecting tools remain excluded from the first production profile until a typed action-specific contract covers exact arguments/targets, user preview, account authority, reconciliation/idempotency, and verification. Calling a tool “read-only” is not enough to enable it unattended.

Even read calls may disclose queries, invoke billing, or cause server-side logs/effects. Include data transfer/cost policy and accurate user disclosure.

## 16. Cancellation, reconnect, retries, and uncertainty

Follow pinned transport cancellation semantics and record actual local/remote evidence. Closing a response stream or sending a cancellation notification does not prove remote rollback.

- Persist runtime cancel/pause before signaling transport.
- Stop new calls and fence stale callbacks.
- Partial results remain protected with incomplete status.
- Reconnect may rediscover/authenticate safely but cannot replay an uncertain tool request automatically.
- Transport/server request IDs do not establish server idempotency; require documented tested operation-key/reconciliation support.
- For non-effect read operations, bounded retry still checks transfer/billing/usage policy.
- For uncertain write/effects, block and reconcile under P0-09; never generate a fresh ID to escape ambiguity.
- Invalid JSON, EOF, timeout, malformed result, or mismatched request/tool identity is not success.

If a local server exits, terminate/reconcile descendants and data effects before replacement. A remote server may keep running after disconnect; disclose that limitation. SDK reconnect/retry defaults must be reviewed/disabled where they could duplicate effects.

## 17. Result normalization, artifact handling, and limits

Normalize MCP results into P0-09 ToolResult: exact identity/binding, outcome/effect certainty, schema validation, protected content/artifacts, safe excerpt, usage/limits, and reconciliation references.

Initial bounds:

| Limit | Baseline |
| --- | --- |
| Tools per connection discovery | 200 maximum, bounded pagination |
| Full schema per tool | 64 KiB, bounded depth/reference/regex complexity |
| Model-selected enabled tools | 8 per step |
| Encoded call arguments | 64 KiB, lower tool-specific bounds preferred |
| One protocol frame/result item | 1 MiB decoded, incremental parsing |
| Total captured result per call | 8 MiB maximum |
| Model-visible excerpt | 16 KiB maximum, original protected artifact retained within cap |
| Concurrent calls | 2 per binding, subordinate to tool/resource/installation policy |
| Discovery deadline | 10 seconds |
| Tool call deadline | 60 seconds default, clipped by run/action contract |
| Progress/notification buffering | Bounded 64 messages per binding; coalesce only documented non-authoritative updates |

Schema/result/input text may be private. Protect full bodies and discovery metadata; default diagnostics use IDs/reason/count/size buckets only. Sanitize ANSI/bidi/markup in UI; no remote code/embed rendering in the privileged main window.

Resource links and artifact URLs remain inert until a scoped fetch contract validates endpoint, auth, size/media, sensitivity, redirects and transfer policy. Do not forward Adham credentials to a result URL. Embedded file URIs cannot access host paths outside root grants.

Output caps/truncation/unsupported formats are explicit. A capped excerpt cannot be represented as complete verification evidence when required detail is missing.

## 18. Memory, graphs, and provider privacy

Skills/MCP get no P0-12 memory read/write authority by installation. Tool results can support scoped memory proposals with provenance; automatic remembrance requires an exact standing rule and protected lineage/deletion.

Sending tool output to a cloud model is a separate disclosure after the MCP/tool operation. Validate source/result privacy and provider grant; permission to contact an MCP server does not authorize forwarding all results elsewhere.

P0-11 child sessions pin exact skill revisions/tool bindings and narrowed delegable grants. Parent/sibling auth/session/state handles and transcripts remain private. Default local stdio instances are separate per project/account/grant binding; any transport pooling must prove no cross-binding state/authorization cache leakage before adoption.

Remote account scopes can expose more data than Adham’s project contract. Enforce request minimization and service/account suitability, disclose remote residual access, and block if meaningful isolation cannot be established. Do not equate UI project tagging with server-side tenant isolation.

Sampling or server-requested context/memory retrieval remains disabled initially. Enabling it later needs an explicit provider/data/budget contract and user controls—not merely a server capability declaration.

## 19. Disable, update, revoke, and quarantine

Skill deactivation/connection suspension/tool disable stops new admission immediately and invalidates relevant context/grant generations. Active effects follow cancel/settlement policy; do not assume disabling UI undoes remote actions.

Changes to skill body/scripts/source owner, server binary/config/endpoint/account, protocol profile, or tool schemas trigger exact affected review. Do not silently update active runs. A reviewed immutable old snapshot may finish only if current policy permits; revoked unsafe versions stop admission and are quarantined.

Uninstall/remove references affects bundled availability but not personal forks/unrelated user skills. User-customized forks have independent identity/provenance; upstream updates do not overwrite them.

Credential revocation stops new authenticated operations and tears down affected handles/caches. External account sessions/remote effects may require separate provider-side revocation; report observed coverage.

Local server writable data stays scoped under approved app-owned storage. Cleanup/export/delete uses P0-09/12 ownership/privacy rules; a config path cannot trigger recursive arbitrary deletion.

## 20. Durable lifecycle, recovery, and protocol compatibility

Persist reviewed configuration/identity, grants/enabled tool revisions, activation/context manifests, auth references, invocation OperationIds, dispatch intent, effect/result journals, and revocation generations. Never persist plaintext tokens, skill prompts, result bodies, or sensitive schemas in structural events.

Crash recovery:

1. Fence old driver/connection/server epochs.
2. Verify configuration/schema/identity and current restrictions.
3. Reconcile active local processes/remote operation uncertainty.
4. Restore disabled/pending-review states faithfully; authentication is not reapproval.
5. Rediscover only authorized non-effect metadata and compare exact generations.
6. Hold changed/unsupported identities/tools for review.
7. Resume only safe approved operations within remaining budget; no blind call replay.

Replay loads records/projections, not processes/auth browsers/network calls. Unknown future capability/protocol/config versions block affected availability; preserving opaque diagnostics is not execution compatibility.

Initial live validation records selected protocol revisions, actual SDK/server versions, tested transports/auth patterns/platforms, and excluded optional methods. Fake protocol fixtures do not prove real sandbox/authentication behavior.

## 21. Events, UI, and IPC amendment

Register versioned capability discovery/review/assignment/activation/resource-load, MCP connection/auth-state/tool-list-change/enable/disable/revocation, and call normalization facts. Reuse P0-09 tool/policy/approval/result events for execution rather than inventing a bypass authority.

Structural payloads contain typed scope/identity/revision/generation, safe state/reasons, counts, and protected references. Full descriptions/skills/schema/arguments/results/headers/auth URLs containing sensitive parameters stay protected.

Settings views keep Skills and MCP separate under Extensions. Show source/version/trust, workspace/project/agent assignment, individually enabled tools, declared versus reviewed effects, endpoint/account, health/auth state, privacy destinations, activity, and known limitations.

Proposed application commands: DiscoverSkillRoots, ReviewSkillRevision, AssignSkill, ActivateSkill, ConfigureMcpConnection, ReviewMcpConnection, AuthenticateMcpConnection, DiscoverMcpTools, SetMcpToolGrant, SuspendMcpConnection, and scoped status/activity/resource queries.

These are not permitted native endpoints until P0-04 DTO/allowlist/window capability/limits/redaction/idempotency/generation tests are amended. Never expose arbitrary subprocess, bearer-bearing HTTP, load-any-path, generic MCP-method dispatch, or server-controlled OAuth browser commands to renderer/model.

Private authentication input goes through secure prompts/vault integrations; no secrets in page/chat instructions. UI preview/control cannot authorize unsupported native security dialogs by assumption.

## 22. Rust ownership and dependency review

```
crates/adham-extensions/src/
├── domain/
│   ├── identity.rs
│   ├── registry.rs
│   ├── skill.rs
│   ├── activation.rs
│   ├── connection.rs
│   ├── binding.rs
│   └── lifecycle.rs
├── application/
│   ├── discover.rs
│   ├── review.rs
│   ├── route.rs
│   ├── activate.rs
│   ├── enable.rs
│   ├── revoke.rs
│   └── recover.rs
└── adapters/
    ├── skills/          bounded parsing and immutable snapshot import
    └── mcp/             protocol-profile transport/auth/schema normalization
```

adham-tools/policy own action authorization/execution contracts; sandbox runner contains local server code; provider gateway owns model calls; context owns selected instruction/schema assembly; memory owns any remembered results. No extension code runs inside trusted Rust domain modules or main renderer.

Review MCP SDK, OAuth/HTTP/parsers, YAML/JSON Schema validation, and sandbox integration for selected versions/features, retries, resource fetching, process spawning, optional methods, and transitive/native impact. Pin tested dependencies/fixtures; no automatic all-capability SDK defaults.

Skill-format validation libraries are candidates, not installation approval. Respect production file target under 300 lines, review above 400, and documented exceptions above 600. No network microservices are needed for ordinary local registries.

## 23. Adversarial and reliability test matrix

| Area | Required evidence |
| --- | --- |
| Skill parsing | Missing/duplicate/unsafe frontmatter; oversized/deep YAML; malicious description; invalid compatibility |
| Paths/resources | Traversal/symlink/reparse/ADS/device/root swap; resource cycle; remote auto-fetch blocked |
| Routing | Same-name source collisions; exact pins preserved; ambiguity; poisoned always-use-me description |
| Authority | allowed-tools cannot grant wildcard shell; scripts remain sandboxed; missing dependencies block |
| Connection startup | Disabled tools still require authorized constrained process; download-on-start config rejected |
| Protocol era | Selected revision schemas; handshake/per-request distinction; unsupported version; no unsafe effect probing |
| MCP schema | Complex/remote refs/regex limits; annotations untrusted; changed schema invalidates; header injection blocked |
| Enablement | Auth/discovery enables zero tools; new tool disabled; wrong scope/stale context binding rejected |
| OAuth/secret | Issuer/resource/audience mix-up; callback/PKCE; scope escalation review; wrong-origin token/redirect denial |
| Network | SSRF through auth/discovery/result URL; DNS/rebinding/private address/proxy/loopback constraints |
| Local containment | Home/vault/DB/socket/child escape; protocol stdout separation; runner crash termination |
| Results | isError vs protocol error; forged success; structured/text contradiction; unsupported modality/link inert |
| Retry/reconnect | Unknown write not replayed; request IDs not idempotency; late callback fenced; cancellation uncertainty |
| Privacy/isolation | Project/account/state-handle separation; no credential/query/result in events/logs; cloud-forwarding denied |
| Memory/subagents | No ambient memory grant/shared sibling context; exact narrowed child bindings |
| Lifecycle | Skill/script/server/tool change; disable/revoke while active; uninstall preserves forks; safe quarantine |
| Recovery | Kill at startup/discovery/dispatch/result/review boundaries; replay spawns zero effects; no duplicate call |
| Verification | Skill/tool finish cannot complete task without applicable P0-10 verdict |

Use synthetic skills, malicious protocol fixtures, fake auth services, and sacrificial test roots first. Live remote tests require explicit account scope/cost/data authority and synthetic content only. Prove native sandbox/profile behavior separately from protocol fakes.

## 24. Implementation and acceptance gates

### G1 — Registry and lazy skills

- [ ]  Canonical source/revision identity, safe snapshots, progressive loading, routing and allowed-tools semantics accepted.
- [ ]  Scripts/resources remain inert until P0-09 authority; injection/path/context-limit fixtures pass.

### G2 — Protocol/profile and local fixture

- [ ]  Supported MCP revision/SDK pair and optional-method exclusions reviewed.
- [ ]  Sandboxed stdio startup/discovery, disabled-by-default tools, schemas and lifecycle tested.
- [ ]  No host proxy/general process spawn bypass introduced.

### G3 — Remote identity/auth proof

- [ ]  Endpoint/auth/account/privacy grants explicitly approved.
- [ ]  Issuer/resource/callback/token/SSRF protections and scope review tested.
- [ ]  Synthetic Streamable HTTP calls conform to normalized tool/effect semantics.

### G4 — Runtime integration

- [ ]  Exact enabled tool/schema snapshots, policy/approvals/budgets/verification, child/memory isolation and reconnect uncertainty tested.
- [ ]  Revocation/config changes invalidate contexts/grants safely; no implicit authority retained.

### G5 — Evidence and compatibility

- [ ]  Registry/IPC/capability/schema amendments reviewed; generated types committed.
- [ ]  Audit/license/native/isolation/fault/privacy gates green on recorded revision.
- [ ]  Tested skill/protocol/transport/auth/platform subset and residual risks documented; unsupported features not advertised.

P0-13 completion validates the declared initial capability profile—not all MCP servers/auth versions, arbitrary scripts, or universal third-party safety.

## 25. Stop conditions and next artifact

Block activation/connection/calls on unknown source/version, unresolved collision, changed tool/server identity, missing containment, insufficient grants, schema ambiguity, unsafe authentication/destination, credential leak, resource limit violation, or uncertain side effects.

Do not enable all tools, import plaintext secrets, trust server annotations as policy, request broad OAuth scopes silently, execute install-on-start commands, follow returned URLs, downgrade TLS, bypass memory grants, or replay unknown calls to recover convenience.

The next specification is **P0-14 — Plugin package trust, isolated execution, and lifecycle contract**: portable manifest conformance, publisher/version/signature provenance, component permission review, package containment, immutable install/staging/quarantine, plugin host/custom UI isolation, updates/rollback, revocation and supply-chain evidence. Bundling skills/MCP into a plugin does not elevate their trust or grant authority.