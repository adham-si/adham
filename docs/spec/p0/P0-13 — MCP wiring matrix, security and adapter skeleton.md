<aside>
🧰

Companion to P0-13. Research matrix only — it authorizes no install, no server launch,
no authentication, no tool execution.

</aside>

# P0-13 — MCP wiring matrix, security and adapter skeleton

## 1. Purpose and boundaries

This document is the research companion to `P0-13 — Skills and MCP capability contract`.
It answers one question: for each MCP transport and integration point, which settings must be
wired, which separate files own each piece, and which security controls come first.

- **Status:** research only. Reading P0-13 or this matrix does not authorize installing skills,
  launching MCP servers, authenticating accounts, importing configurations, invoking remote
  tools, or exposing additional IPC commands.
- **Scope:** Agent Skills ingestion/routing plus MCP connections — local stdio servers and remote
  Streamable HTTP endpoints. Plugin packaging/trust remains P0-14; tool execution/policy stays
  P0-09; verification stays P0-10.
- **Implementation order is unchanged (P0-13):** reviewed local skill snapshots → one sandboxed
  local stdio fixture with synthetic bounded tools → one separately approved HTTPS Streamable
  HTTP connection proving identity/auth/grant and isolation → production enablement of the
  validated subset only.
- **Excluded initially:** legacy HTTP+SSE, unconstrained network-enabled local servers,
  server-requested sampling/elicitation, automatic resource subscriptions, hosted code/UI
  execution, autonomous capability installation, generic cross-project tool access.
- **Protocol decision gate (P0-13 §1):** pin one supported revision/SDK pair after review.
  Inspected baseline is MCP `2026-07-28` (per-request `_meta`, `server/discover`) versus the
  `2025-11-25`-and-earlier era (`initialize` handshake, `Mcp-Session-Id`). Dual-era support is a
  deliberate tested matrix, never automatic universal compatibility.
- **Data hygiene:** all commands, URLs, tokens, and fingerprints here are synthetic placeholders.
  No real credentials, user content, or machine paths.
- **File-size note:** target under 600 lines; split per transport/family before review if it grows
  past that.

## 2. Shared wiring and identity schema

Installation, discovery, assignment, activation, schema loading, and execution are separate
permissions and states. Models, skills, and servers can never install, enable, authorize, or
change their own capabilities.

### 2.1 Connection identity

`McpConnectionId` binds: `ServerBindingId`, service kind (`LocalStdio` | `RemoteStreamableHttp`),
endpoint or reviewed executable snapshot, authorized account/credential references, protocol
profile (pinned revision, e.g. `2026-07-28`), configuration revision, and grants. Connection
states: `proposed → reviewed → configured-disabled → connecting → discovery-ready →
active-for-selected-tools`, plus distinct `unhealthy / suspended / auth-required / revoked /
quarantined`.

Canonical tool identity binds connection, server generation, exact tool name, schema/behavior
revision, and reviewed policy profile. A friendly name is never unique authority; collisions need
explicit resolution. The server's self-reported name/version/description is display evidence only —
TLS and account authorization prove only their own boundaries, and remote implementation changes
may be unobservable.

### 2.2 Imported configuration rules

`.mcp.json` / `.vscode/mcp.json` / `.cursor/mcp.json` / plugin `mcp.json` imports are untrusted
inputs. The import preview shows source, executable/endpoint, environment/header references,
requested destinations/scopes, possible code execution, and intended project/account assignment.

- Never import plaintext secrets into ordinary config or project files; offer vault-backed
  migration via private input with no log/prompt echo. Finding a secret never authorizes using it.
- Command imports are structured `executable + argv` — never shell strings. Implicit
  `npx`/`uvx`/download-on-start/install commands are rejected or need a separate reviewed
  transformation; connecting is not authority to fetch or execute unpinned code.
- Launching a local server is arbitrary code execution even before tools are enabled: startup and
  discovery require P0-09 sandbox/installation/binary authority. Disabled tools do not contain an
  unconstrained server process.
- Remote discovery/auth requests may contact third parties and expose endpoint/account/client
  metadata; they need an explicit connection operation but send no project prompt/files by default.

### 2.3 Skill identity and loading bounds

Skill identity binds source kind, owner, `SkillId`, immutable revision/content snapshot,
provenance, trust/review state, and assignment scope
(`user:<owner>/<skill>@<rev>`, `workspace:…`, `project:…`, `plugin:<publisher>/<package>/<skill>@<ver>`).
Progressive loading in three stages — metadata discovery, activation (full reviewed `SKILL.md`),
resources (only referenced files needed for the current phase) — under explicit bounds: metadata
shortlist ≤20, 1 primary skill per phase (+2 helpers max), `SKILL.md` ≤64 KiB, resource ≤256 KiB
per load (≤10 loads, ≤1 MiB cumulative), traversal depth ≤2 with cycle detection.
`allowed-tools` in frontmatter is a declared constraint evaluated against existing grants, never
authority. Descriptions can carry prompt injection — treat as routing data, never instructions.

## 3. Transport wiring matrix

Conventions mirror §3 of the provider matrix: the adapter owns exactly one connection mechanism
per record; origins/executables come from an allowlist, never from model output or renderer
input. Wire notes tell the transport owner what to parse — Adham normalizes everything into its
own tool-call/result contract before the runtime or renderer ever sees it.

### 3.1 Local stdio — sandboxed fixture first

- Launch: pinned executable snapshot + explicit `argv` vector + reviewed minimal environment.
  No shell interpolation, no inherited host environment, no user home, no Adham DB/vault, no
  Docker socket, no SSH agent, no sibling state.
- Wiring: private OS pipes; one server instance per immutable project/account/grant binding;
  dedicated bounded scratch/data; offline profile first (network-enabled local servers need a
  later validated egress/credential profile).
- Protocol: `stdout` is JSON-RPC only; `stderr` is bounded protected diagnostics, never control
  messages. Modern era: probe with `server/discover` first, fall back to `initialize` only on a
  non-modern error; cache the era per server process.
- Credentials: environment-based credentials are protocol-allowed but Adham-scoped — a
  server-specific credential reference resolves only under explicit narrow authority, with the
  documented warning that the child process can observe any secret it must directly receive. The
  initial offline fixture receives no secret.
- SDK mapping (`rmcp`, official Rust SDK): client side `TokioChildProcess` + `Command`
  (`transport-child-process`); server side `io::stdio` (`transport-io`). Lifecycle: descendant
  lifetime, resources, cancellation, and recovery follow P0-09; connection loss fails closed.
- Pitfalls: stdio launch = code execution (CurXecute CVE-2025-54135: crafted Slack message rewrote
  `mcp.json`, auto-executed on next IDE interaction); MCPoison CVE-2025-54136: committed repo
  configs auto-executed by four major CLIs on folder-trust accept. Design takeaway: no
  auto-execution on config change, no affirmative-default trust prompts, folder trust never
  implies server launch.

### 3.2 Remote Streamable HTTP — separately approved proof second

- Endpoint: single `POST {origin}/mcp`, `Content-Type: application/json`. Required headers:
  `MCP-Protocol-Version` (must equal `params._meta.io.modelcontextprotocol/protocolVersion`,
  e.g. `2026-07-28`), `Mcp-Method` (JSON-RPC method, e.g. `tools/call`), `Mcp-Name` for
  `tools/call` / `resources/read` / `prompts/get` (Base64 sentinel if not plain ASCII).
- Handshake: `server/discover` returns `supportedVersions`, `capabilities`, `serverInfo`,
  optional `instructions` (untrusted text — routing hint only), `ttlMs`/`cacheScope`. Clients may
  call RPCs inline and handle `UnsupportedProtocolVersionError`; unsupported versions fail with a
  safe actionable message, never a silent fallback that changes endpoint/account/privacy/grants.
- Modern-era rules (2026-07-28): no sessions — ignore `Mcp-Session-Id`/`Last-Event-ID`, never mint
  or echo them; `GET`/`DELETE` on `/mcp` → `405`. Server answers each POST with one JSON object
  or one SSE stream. Era is cached per origin; re-probe when the assumption fails.
- Legacy era (2025-11-25 and earlier): `Mcp-Session-Id` assignment, `DELETE` termination,
  standalone `GET` SSE streams, `Last-Event-ID` resumption, server-initiated JSON-RPC requests.
  Supported only as a deliberate tested matrix entry — never blended with modern semantics.
- Transport bounds: enforce a transport-wide max SSE event size at the raw byte layer before SSE
  parsing (rmcp: `StreamableHttpClientTransportConfig::max_sse_event_size`, not per-request);
  bound response bodies, header counts, and reconnect budgets; cancellation cannot imply rollback
  or authorize blind retries of uncertain calls.
- SDK mapping (`rmcp`): `StreamableHttpClientTransport::from_uri` (+ `…-reqwest` feature) or
  `with_client` for a custom backend; server side `StreamableHttpService`
  (`transport-streamable-http-server`); lifecycle `serve_with_lifecycle` with
  `preferred_versions: [V_2026_07_28]`, `legacy_version: Some(V_2025_11_25)`.
- TypeScript reference (for fixture authors, not Adham runtime): `McpServer` +
  `registerTool(name, {description, inputSchema: zod, annotations}, handler)` +
  `StdioServerTransport`; client `StreamableHTTPClientTransport` + `callTool`/`getPrompt`.
  Annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) are hints, never evidence.
- Pitfalls: session-hijack CVEs from unbound session IDs (Python SDK CVE-2026-52869 7.1; Ruby
  CVE-2026-67430); stale-state bugs where pre-initialize streams break tool listing (rust-sdk
  #468). Design takeaway: Adham's modern profile has no sessions at all — no session table, no
  session fixation surface; legacy profile needs owner-bound sessions or stays unsupported.

### 3.3 OAuth and token wiring (remote only)

- Flow: OAuth 2.1 with discovery; client sends RFC 8707 `resource` parameter so tokens bind to
  the intended MCP server; server validates audience (reject tokens not naming it) per OAuth 2.1
  §5.2. The upstream-API token is a separate token — the server MUST NOT pass through the token
  it received from the client (confused-deputy / CVE-2026-63127 class: malicious metadata luring a
  legitimate token to a malicious server, 8.2 High).
- Hygiene: short-lived access tokens, refresh rotation for public clients, secure storage both
  sides, no tokens in logs/exports/prompts/event payloads/renderer state. Token theft = full
  resource access — treat accordingly.
- Redirects: never forward credentials across origins (rmcp CVE-2026-64684 class: non-standard
  header auth leaked on cross-origin redirect while `Authorization` was stripped; fixed 2.1.0).
  Adham rule from P0-08 applies unchanged: redirects disabled by default.
- DoS guard: any stateful bookkeeping (legacy session tables, connection registries) is
  bounded with handshake rate limits and loud degradation. This is how the session-table
  exhaustion class is answered; the modern no-session profile additionally removes the session
  table entirely (rmcp CVE-2026-63128 class, fixed 2.0.0).

### 3.4 Resources, prompts, and what stays out

- `resources/read` and `prompts/get` go through the same connection binding, grant check, and
  size/redaction bounds as `tools/call`. Resource links, schemas, prompts, and returned URLs
  never trigger automatic file/network loads. Server `instructions` text is untrusted.
- Out of initial scope (requested by servers, denied by default): sampling/elicitation
  (server-requested model calls or user prompts), automatic resource subscriptions, hosted
  code/UI execution. Each needs its own contract before enablement — a server asking for them is
  a signal, not an entitlement.

## 4. Security-first controls

These apply before any tool is enabled. A valid signature, marketplace badge, successful
install, local process, or authenticated connection is never permission to execute and never
proof of safety.

1. **Default-deny tools.** MCP tools start disabled individually; authenticating a connection
   enables nothing. Each tool needs its own grant against the canonical registry identity.
2. **Server-side enforcement, not prompt instructions.** System-prompt restrictions
   (“do not read outside X”) are overrideable text. Every boundary — filesystem scope, network
   destinations, credential access — is enforced at the execution layer (OWASP tool-poisoning
   guidance; measured 36.5% average poisoning success, 72.8% peak — CSA 2026).
3. **Privilege separation.** High-privilege tools (files, DB, internal APIs) run in an agent
   context unreachable from external MCP servers. External tool results can never trigger
   internal tools by content alone; cross-server orchestration is policy-gated.
4. **Treat all server content as untrusted.** Tool lists, descriptions, schemas, results,
   skill bodies, icons, licenses: untrusted inputs. Validate schemas and result shapes;
   `readOnly`/`idempotent` annotations prove nothing. Microsoft (2026) rates tool descriptions
   as supply-chain assets with production-code review rigor; OWASP lists tool poisoning in its
   MCP Top 10 (#3).
5. **Rug-pull resistance.** Pin tool schema/behavior revisions at grant time; server, account,
   endpoint, schema, or implementation changes invalidate affected grants and pinned contexts.
   Re-approval on description/behavior change — a malicious server that edits its description
   after approval (Invariant Labs rug-pull class; tool shadowing across servers) gains nothing.
6. **No ambient inheritance.** Child sessions get explicit capability subsets with pinned
   identities; installed capabilities get no memory access without a separate P0-12 grant.
7. **Human confirmation outside LLM context.** Destructive or exfiltrating actions prompt the
   user through trusted UI before execution — the model cannot pre-approve via tool text, and
   skill-supplied “preapproval” language is not a human approval record.
8. **Localhost is attack surface.** Validate `Host`/`Origin` on any local HTTP surface; default
   `--allowed-origins=*` without host enforcement is a DNS-rebinding hole (CVE-2026-11624 on
   mcp-toolbox; Ruby CVE-2026-63119). No exposed unauthenticated localhost bridge, no generic
   renderer-driven subprocess spawn service.
9. **Path containment.** Prefix-match directory checks are bypassable (filesystem-server
   CVE-2025-53110 path traversal). Use open-handle / identity-backed roots, canonicalized
   comparison, symlink/reparse rejection.
10. **No shell interpolation.** Structured argv only (mcp-package-docs CVE-2025-54073: unsanitized
    input into `child_process.exec` → RCE via indirect prompt injection through package docs).
11. **Broad tokens are exfiltration paths.** Single tokens spanning public+private scopes turn one
    injected issue/comment into a private-data heist (Docker GitHub horror-story class). Scope
    tokens per connection; least privilege per tool.
12. **Registry distrust.** 67k-server DSN 2026 study: weak vetting/ownership enables hijacking;
    833 vulnerable + 18 suspicious servers found. Prefer verified publishers with security
    policies, review source before deployment, subscribe to advisories, keep an explicit
    allowlist — never arbitrary user-pointed servers.
13. **Protocol pivoting awareness.** Agent-to-agent delegation can launder trust across protocols
    (Ars 2026-10-05: MCP→A2A forwarding loses authorization context). Handoffs carry explicit
    capability subsets, never ambient authority.

## 5. Adapter skeleton, risk log, sources, and open decisions

### 5.1 Skeleton (names only — no code authorized)

```
crates/adham-extensions/src/
├── lib.rs                 # Public API only
├── skills/
│   ├── mod.rs             # Snapshot ingestion, frontmatter validation, quarantine
│   ├── routing.rs         # Registry search, activation manifests, conflict handling
│   └── loader.rs          # Progressive loading with §2.3 budgets
└── mcp/
    ├── mod.rs             # McpConnectionId, ServerBindingId, connection state machine
    ├── registry.rs        # Canonical tool identities, per-tool grants, revision pins
    ├── config.rs          # Import preview, structured command/argv validation, vault migration
    ├── transports/
    │   ├── mod.rs        # Transport port trait (send-concurrent / receive-sequential)
    │   ├── stdio.rs      # TokioChildProcess spawn, private pipes, stderr bounds, era probe
    │   └── streamable_http.rs  # POST /mcp, headers, discover, SSE bounds, no-session profile
    ├── auth.rs            # OAuth discovery, RFC 8707 resource binding, audience validation
    ├── tools.rs           # list/call normalization, schema + result validation, redaction
    ├── error.rs           # Safe taxonomy (transport/auth/capability/policy/budget)
    └── tests.rs           # Fixture replay: poisoned descriptions, rug-pull diffs, truncated
                           # streams, 400/401/404/405 paths, rebinding attempts, oversized bodies
```

Pinned-SDK note: record one revision/SDK pair (baseline `2026-07-28` + `rmcp` ≥2.1.0, which
carries the redirect-auth and session-DoS fixes) after compatibility/security review. Dependency
approval still follows the P0 decision gate — names here are not approval.

Frontend surface (no secrets cross IPC to the renderer): server list (identity + health +
protocol profile), import preview (source, executable/endpoint, scopes, code-execution warning),
per-tool enable toggles (disabled by default), grant scope labels, revocation/quarantine states.
Typed commands: `list_mcp_servers`, `preview_mcp_import`, `save_mcp_connection` (keyring ref
only), `test_mcp_connection` (metadata/discover only, no prompt, no tool call),
`set_mcp_tool_grant`, `revoke_mcp_connection`. DTOs via `ts-rs`, committed, CI drift-checked,
Zod-validated at the boundary.

### 5.2 Risk log (signal → Adham rule)

| # | Signal | Adham rule |
|---|---|---|
| M1 | Tool poisoning / TPA (OWASP; Invariant Labs; 36.5–72.8% success) | §4.2–4.4: server-side enforcement, privilege separation, untrusted-content validation |
| M2 | Rug pulls + tool shadowing across servers | §4.5: revision pinning, re-approval on change, explicit collision resolution |
| M3 | Auto-execution (CurXecute 54135 8.6; MCPoison 54136; folder-trust defaults) | §3.1: no auto-execution, no affirmative-default prompts, launch = code execution |
| M4 | DNS rebinding (CVE-2026-11624; Ruby CVE-2026-63119) | §4.8: Host/Origin validation, no open localhost bridge |
| M5 | Session hijack via unbound IDs (Python CVE-2026-52869; Ruby CVE-2026-67430) | §3.2: modern profile has no sessions; legacy needs owner binding or stays out |
| M6 | Token theft / passthrough / confused deputy (CVE-2026-63127 8.2; rmcp 64684) | §3.3: RFC 8707 binding, audience validation, no passthrough, no cross-origin creds |
| M7 | Session-table DoS (rmcp CVE-2026-63128) | §3.3: bounded tables, handshake rate limits |
| M8 | Path traversal (CVE-2025-53110) | §4.9: handle-backed roots, canonicalization, link rejection |
| M9 | Command injection via tool input (CVE-2025-54073; LiteLLM CVE-2026-30623) | §4.10: structured argv, no shell strings |
| M10 | Broad-token exfiltration (GitHub issue-heist class) | §4.11: per-connection scoped tokens |
| M11 | Registry hijacking (DSN 2026: 833 vulnerable servers) | §4.12: allowlist, publisher verification, advisory subscriptions |
| M12 | Protocol pivoting MCP→A2A (Ars 2026-10) | §4.13: explicit handoff subsets, no ambient authority |

### 5.3 Sources

- Context7: `/websites/modelcontextprotocol_io_specification_2026-07-28` (Streamable HTTP
  `POST /mcp` headers, `server/discover`, versioning/era fallback, authorization + security
  considerations — token theft, confused deputy, audience binding, passthrough ban);
  `/modelcontextprotocol/typescript-sdk` (`McpServer` + `registerTool` + Zod + transports,
  `callTool`/`getPrompt`, `authInfo` in handlers).
- Live channels (`agent-reach doctor` 4/16 verified last session: V2EX, RSS, Jina Reader,
  Bilibili-search; GitHub/YouTube/Exa + 9 login channels unavailable).
- Web: OWASP MCP Tool Poisoning; Invariant Labs TPA + rug-pull/shadowing research; CSA
  tool-poisoning/auto-execution note (2026-07-01); Microsoft indirect-injection guidance;
  Elastic attack/defense matrix; Docker GitHub heist + gateway flags; Ars protocol-pivoting
  (2026-10-05); IEEE DSN 2026 registry study; OpenCVE rmcp/Python/Ruby advisories; NVD
  CVE-2025-53110; GHSA CVE-2025-54073; `docs.rs/rmcp` transports + `StreamableHttpClient`
  byte-layer limits; rust-sdk `streamable_http.rs` lifecycle example + issue #468.
- Repo: `P0-13 — Skills and MCP capability contract.md:1-200` (order, invariants, identities,
  discovery, loading bounds, routing, scripts, import, stdio isolation); `P0-14 …:1-120`
  (package conformance, trust dimensions, layout); `P0-09 …:1-80` (first tool set, invariants,
  trust path).

### 5.4 Open decisions (human-gated, unchanged)

Same six as the provider matrix: Apache-2.0 license (no placeholder); Node 24 LTS; `ts-rs`
for P0 IPC DTOs; manual Vite + `pnpm tauri init`; domain-command boundary; dependency-set
approval before any install. Plus P0-13's own gate: pinned revision/SDK pair after review.

This matrix authorizes nothing: no Phase A, no installs, no server launches, no authentication,
no tool calls, no new IPC surface.
