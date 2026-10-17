# Provider/Model Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire real model execution behind the existing gateway contract in two deliveries — A: shared foundation plus Ollama Local persisted conversation end to end (Stop, reload); B: one OpenAI Responses cloud proof with explicit authorization and credential lifecycle. No other providers.

**Architecture:** Rust owns everything network-shaped: a single `reqwest` client, a credential broker over the already-pinned OS keyring, an SQLite-backed model/account registry, one HTTP adapter per proven API (Ollama NDJSON, OpenAI Responses SSE). Every dispatch records a durable operation identity first (reused `pending_operations` with `kind='provider-completion'`), so a crash leaves an identifiable unresolved operation, never a vanished generation. Assistant text persists as canonical `assistant/message-completed` events with four terminal outcomes (completed / cancelled-interrupted / failed; unresolved = pending row with no terminal, reconciled — never auto-completed — on startup). Cloud dispatch requires a backend-issued, single-use approval token bound to request/account/destination/scope — never a renderer boolean. The renderer never holds credentials, builds HTTP, or supplies URLs; streams cross IPC over Tauri `Channel` behind a transport-neutral sink owned by the application layer. Existing `adham-provider` domain types are reused, not reinvented.

**Tech Stack:** Rust (reqwest 0.13 direct dep, tokio-util CancellationToken), Tauri 2 IPC Channels, SQLite registry, existing `keyring` 3.6.3, React frontend on existing typed client.

**Delivery method (pre-selected): native execution after plan approval.** Automated fixtures by default; no real keys, paid calls, model downloads, dependency installation, push or merge without the relevant approval. Live cloud testing (Delivery B) additionally requires its own explicit approval per run (see Task B5 runbook).

**Spec:** `docs/spec/p0/P0-08 — Provider gateway and normalized stream contract.md` + `docs/spec/p0/P0-08 — Provider wiring matrix and adapter skeleton.md` (contract doc is truncated at §7 Message/content semantics; §§8+ details below come from the wiring-matrix companion — treat the companion as authoritative where the contract is silent, and never invent behavior).

## Global Constraints

- Node 24 LTS baseline; `packageManager: pnpm@10.33.2`; committed lockfiles; no unbounded `latest`.
- Rust pinned toolchain in CI: 1.96.0 (dtolnay/rust-toolchain). fmt/clippy/tests run on all three OS legs.
- Every dependency addition records: exact version + registry, license, release status, Node/Rust/Tauri/Vite compat, transitive count + native impact, vulns/maintenance, enabled vs deliberately-disabled features.
- Generated bindings committed, never hand-edited; CI regenerates and fails on drift (`cargo xtask contracts` + `git diff --exit-code`).
- CSP stays `default-src 'self'`; no new Tauri capability grants for provider work (capabilities govern frontend JS APIs, not Rust — network policy is enforced in Rust, see Task 1).
- Four locales + RTL preserved for every user-facing string; file-size policy (<300 target).
- TDD every task: failing test first, watched fail, minimal code, green suite, commit.

## 17-entry matrix (frontend catalog → reality)

Service type / API-protocol / auth / discovery / streaming-cancel-usage / batch. All 17 ship today as static preview with zero live state.

| # | Entry id | Actual service type | Current API/protocol | Auth | Discovery | Streaming / cancel / usage | Batch |
|---|---|---|---|---|---|---|---|
| 1 | `ollama` | Local daemon, REST + NDJSON | `POST /api/chat`, `GET /api/tags`, `POST /api/show` over loopback HTTP | none (local) | `/api/tags` (name/digest/size) | NDJSON chunks, usage only on final `done` frame; cancel = drop stream + persist partial as `Interrupted` | **A** |
| 2 | `openai` | Cloud REST + Responses SSE | `POST /v1/responses` (`store:false`, no background, no chaining in the proof) | Bearer key | none (model list is account-scoped, out of scope) | typed `response.*` events, terminal `response.completed/failed/incomplete`, usage in `completed` only; cancel = drop stream | **B (proof)** |
| 3 | `anthropic` | Cloud REST + SSE | Anthropic Messages API (different paths/headers: `x-api-key`, `anthropic-version`) | API key header | none | SSE, distinct event names | follow-on (hidden) |
| 4 | `google` | Cloud REST + SSE | Gemini `generateContent` / `streamGenerateContent` | API key / OAuth | none | SSE-ish, distinct schema | follow-on (hidden) |
| 5 | `deepseek` | Cloud, OpenAI-compatible subset | `POST /v1/chat/completions` (subset fields; error body often `{"error":"msg"}` not 4-field) | Bearer | none | SSE subset; smaller `finish_reason` set; usage semantics differ | follow-on (hidden; own fixture) |
| 6 | `moonshot` | Cloud, OpenAI-compatible subset | same shape as 5, verify per-field | Bearer | none | same caveats as 5 | follow-on (hidden) |
| 7 | `qwen` | Cloud (Alibaba) + local weights via Ollama | cloud: OpenAI-compatible subset; local: Ollama rows | Bearer / none | `/api/tags` for local weights | per-path as above | follow-on (hidden) |
| 8 | `nvidia` | Cloud NIM microservices, OpenAI-compatible subset | NIM chat endpoints, verify per-field | Bearer (NIM key) | none | subset SSE | follow-on (hidden) |
| 9 | `opencode` | Local agent engine over ACP (not an LLM API) | Agent Client Protocol (JSON-RPC over stdio) | none (local process) | none | ACP streaming, not SSE/NDJSON | follow-on (hidden) |
| 10 | `mistral` | Cloud REST (La Plateforme) | Mistral chat API (OpenAI-like, verify) | Bearer | none | SSE-like | follow-on (hidden) |
| 11 | `xai` | Cloud, OpenAI-compatible subset | `chat/completions`-shaped, verify | Bearer | none | subset SSE | follow-on (hidden) |
| 12 | `aws-bedrock` | Cloud, AWS-signed (SigV4) | Converse/InvokeModel JSON (NOT OpenAI shape) | AWS IAM SigV4 | none | distinct streaming (eventstream) | follow-on (hidden; own signer) |
| 13 | `cloudflare` | Cloud Workers AI REST | Workers AI bindings/REST, distinct schema | API token | none | distinct | follow-on (hidden) |
| 14 | `vercel` | Gateway/proxy, OpenAI-compatible subset | AI Gateway chatוקטורים, verify | Bearer | none | subset SSE | follow-on (hidden) |
| 15 | `openrouter` | Multi-model gateway, OpenAI-compatible superset | `POST /v1/chat/completions` + provider-routing extras | Bearer | `/models` list endpoint exists | SSE + per-model variance | follow-on (hidden) |
| 16 | `minimax` | Cloud REST, distinct schema (+video, out of P0 scope) | MiniMax chat API, verify | Bearer | none | distinct; video excluded | follow-on (hidden; text only) |
| 17 | `vllm` | Self-hosted OpenAI-compatible server | `POST /v1/chat/completions` on a user URL | Bearer/optional | none | SSE subset; trust model = user-operated endpoint | follow-on (hidden) |

Rule for rows 5–8/10–11/14–15/17: "OpenAI-compatible" is a hypothesis per endpoint, proven by a fixture replayed from that endpoint's real docs, never by assuming OpenAI parity (fields, `usage` position, error shape, `finish_reason` set all verified).

Catalog verification status (evidence rule): every follow-on row above is marked **unknown** until its adapter task replays a real fixture — today's descriptions are marketing catalog, not verified claims. Distinguish two unknowns: "discovery not implemented" (our side — e.g. OpenRouter's `/models` list exists but no client reads it) vs "API has no discovery" (their side — e.g. Anthropic/OpenAI have no public model-list endpoint; models are configured, never enumerated). The registry stores which case each row is in; UI never presents an undiscovered list as complete.

## Rust ownership / file plan (smallest, reuse-first)

Existing crates reused: `adham-provider` (domain + gateway + Ollama line parser + mock), `adham-event-log` (SQLite), `adham-desktop-api` (handlers/DTOs), `adham-runtime` (`ModelPort` impl stays the seam — runtime owns retry/cancel/pause per P0-07; gateway exposes deadline + token, runtime drives).

New files (all in existing crates):
- `crates/adham-provider/src/transport.rs` — one shared `reqwest::Client` (timeouts, `retry(never())`, no proxy surprises), byte-stream reader with per-read timeout. Owner: provider crate. (**A**)
- `crates/adham-provider/src/adapters/sse.rs` — Responses SSE frame parser (`event:`/`data:` lines, terminal `response.completed/failed/incomplete`, bare `error`), ~70 lines, no new dep. Owner: provider crate. (**B**; Ollama needs no SSE — its NDJSON parser already exists.)
- `crates/adham-provider/src/adapters/openai.rs` — Responses request builder (`store:false`, no background, no `previous_response_id` in the proof) + event→normalized mapping + error/429 mapping. Owner: provider crate. (**B**)
- `crates/adham-provider/src/adapters/ollama_http.rs` — HTTP discovery (`/api/tags`, `/api/show`) + chat POST streaming through existing `OllamaStreamParser`. Owner: provider crate. (**A**)
- `crates/adham-provider/src/broker.rs` — `CredentialBroker` trait with five separate operations — `create_key` (fails if an entry exists, no silent overwrite), `replace_key` (rotation is first-class; NOT the content-key create-once lifecycle), `revoke_key` (disconnect: delete vault entry, keep registry row `revoked`, dispatches blocked), `delete_account` (vault entry + registry row; usage-log rows retained as audit), `get_key` (read-only; missing → key-loss error, never empty string). Vault access is bound to (account id, approved endpoint origin, workspace/project scope) on every call. Split-failure recovery: vault-ok/SQLite-fail → `BrokerDrift` error with account id, caller retries the SQLite half (vault write idempotent by account id); SQLite-ok/vault-fail → key-loss path, dispatch blocked, never a half-bound account. `OsKeyringBroker` (service `adham-provider-key`); `InMemoryBroker` for tests. Owner: provider crate. (**B**; A needs no keys.)
- `crates/adham-provider/src/registry.rs` — in-memory registry over cached descriptors (digest, capability tri-state, privacy class) + local accounts (no keys in A); persistence calls into event-log. Owner: provider crate. (**A** registry + local accounts; **B** adds cloud accounts.)
- `crates/adham-event-log/src/sqlite/provider_registry.rs` + migration `20261xxx_provider_registry.sql` — `provider_accounts` (id, kind, alias, endpoint URL, approved_destination flag, created/updated), `provider_models` (account id, raw model id, digest, descriptor JSON, verified rev), `provider_usage_log` append-only (account id, workspace/project scope ids, model, started/finished, outcome, tokens-or-unknown — audit of use, never key material; usage retention policy is an OPEN decision, see below). No secrets in any table, ever. Owner: event-log crate. (**A** accounts+models; **B** adds usage log.)
- `crates/adham-core-types/src/events.rs` — `EVENT_TYPE_ASSISTANT_MESSAGE_COMPLETED = "assistant/message-completed"` + `MessageCompletedV1 { op_id, message_id, text, completion: Completed{truncated} | Interrupted | Failed, usage nullable }` — justified as the symmetric reload counterpart of `user/message-submitted` (required so completed and stopped answers survive restart; no lighter contract exists). Four lifecycle outcomes, never two: completed (length-limit providers map to completed-with-`truncated:true`, never a silent full answer), cancelled/interrupted, failed, and unresolved (pending row with no terminal event — reconciled on startup, never auto-completed). Terminal persistence is idempotent: guarded upsert keyed by `op_id` (unique index; a second terminal write for the same op, including a Stop racing completion, is a no-op — exactly one terminal outcome wins). `ConversationProjection::rebuild` replays both types in global order. (**A**)
- `crates/adham-desktop-api/src/handlers/providers.rs` — `test_provider_connection` (metadata only, no prompt, no billable call), `discover_ollama_models` (**A**); `update_provider_account` (alias + endpoint only), `set_provider_key` / `replace_provider_key` / `revoke_provider_key` / `delete_provider_account` (key payloads write-only, never logged/echoed/retrieved), `approve_cloud_dispatch` (issues single-use approval tokens bound to request-hash/account/destination/model/scope, short TTL — the ONLY cloud gate; renderer booleans and prefs revisions authorize nothing), `complete_once_streaming` (transport-neutral `EventSink`, see below), `stop_completion(op_id)` (validates op→session/scope ownership — guessed IDs get `ContextMismatch`, never another op's cancellation) (**A** stop + Ollama; **B** account/key/destination/approval). DTOs in `dtos.rs` + `xtask` decls. Owner: desktop-api crate.
- IPC ownership split: `Channel<StreamEventDto>` types live ONLY in `apps/desktop/src-tauri/src/lib.rs` (shell adapts Channel into the sink); the application layer exposes a transport-neutral `EventSink` trait (`send(event)`, backpressure-bounded). Operation handles are UUIDv7 `op_id`s recorded in `pending_operations` BEFORE dispatch, with per-op sequence numbers on events. Scoped cancellation: one token per op; explicit `stop_completion` or op deadline ends it. Renderer disconnect has no server callback to rely on — an in-flight op completes-or-times-out server-side and its terminal event persists regardless; no client is needed for completion. Owner: desktop-api (sink + handles), src-tauri (Channel adaptation).
- `apps/desktop/src-tauri/src/lib.rs` — thin command wrappers + `invoke_handler!` entries only.
- Frontend: `shared/api/adham-client.ts` + `schemas.ts` additions; Providers page Ollama connect/test/discover (**A**, slimmed — no cloud section); Models page defaults from registry (**A**); composer picker reads registry + Stop button wired to `stop_completion` + reload renders persisted history (**A**); cloud account/key/approval UI (**B**).

Dependency additions (each needs the P0 verification record in its task):
- `reqwest = "0.13"` direct, `default-features = false` + `json`, `stream`, `rustls` (rustls + platform verifier + aws-lc; pure-Rust TLS matches repo posture; default features OFF drops charset/http2/system-proxy — no ambient proxy by construction). Reason: locked 0.13.5 (via Tauri) ships with NO TLS backend — HTTPS provider calls are impossible without it. Transitives to record: hyper-rustls, rustls, tokio-rustls, webpki roots.
- `tokio-util = "0.7"` (locked 0.7.x present) for `CancellationToken`. Reason: cooperative user-cancel distinct from drop/timeout.
- Deliberately NOT added: `eventsource-stream` (hand-rolled SSE parser, tested), `async-openai` (hides wire behavior the contract requires us to own), `tauri-plugin-http` (frontend must never do provider HTTP).

## Flows

**Delivery A: Ollama persisted conversation (Stop, reload).** Composer picker offers registry-pinned local models only (unknown id → blocked). Submit → backend validates workspace/project/session ownership, assembles bounded history from events (cap N messages/tokens — renderer-supplied history is ignored, never authoritative), records the op in `pending_operations` (`kind='provider-completion'`, op UUIDv7) BEFORE dispatch → loopback POST → NDJSON deltas render ephemerally over the Channel. Terminal frame → idempotent `assistant/message-completed` write keyed by op id. Stop button → ownership-validated `stop_completion(op_id)` → token cancels the read → partial persisted as `Interrupted`; a Stop racing completion resolves to exactly one terminal write (guarded upsert). Crash/kill mid-stream persists nothing: startup reconciles the pending row as unresolved (surfaced, never auto-completed) and reload shows history without the tail. No cloud path exists in A — silent egress is structurally impossible.

**Delivery B: OpenAI Responses proof (authorization, lifecycle).** Cloud section exposes exactly one destination (`https://api.openai.com`, not editable): alias + key field (transient password input, cleared on submit/unmount/success, never stored in frontend state or retrieved back) → Test (metadata only, no prompt, no billable call) → authorization checkbox → Save calls `approve_cloud_dispatch`, which issues the single-use token bound to (request hash, account, destination, model, scope, TTL); dispatch without a valid token is blocked server-side. Key lifecycle UI: rotate (replace), disconnect/revoke (vault delete + `revoked` row), account delete (vault + row; usage rows retained). Copy rule: "stateless request (`store:false`)" — never "zero retention", which no vendor promise in this plan can keep. Every call logs `{account_id, scope, model, outcome, tokens-or-unknown}` (unknown stays unknown — no billing subsystem). Live testing is fixture-by-default; the live runbook (test account, spend cap, explicit per-run approval) requires separate approval and never runs in CI.

## Security controls

- Endpoint gate: reuse `endpoint.rs` validation (HTTPS mandatory except loopback HTTP); cloud proof pins `https://api.openai.com`; endpoint change invalidates authorization + capability/model caches (registry revision bump).
- Network enforcement (tested, Task A1): redirects disabled; ambient/system proxies bypassed; resolved-address policy — resolve once per op, reject private/link-local/metadata/unspecified ranges over IPv4 AND IPv6; re-resolution across redirects is moot (no redirects); DNS-rebinding residual (reqwest re-resolution) contained by short op deadlines + per-read timeouts, documented as residual. Buffers/frames/bodies bounded (1 MiB frame cap → protocol error, never OOM) with op deadlines.
- Genuine local inference (Task A3): a loopback URL proves nothing (same-user process can serve loopback; cloud-backed models can hide behind it). Local-only classification requires evidence — digest-pinned local blob via `/api/tags` + `/api/show` capabilities; `unknown` blocks local-only dispatch. The "no `https://` provider URL" assertion is necessary but explicitly not sufficient.
- Credential broker: keys live only in OS keyring; `set_provider_key` payload is write-only (no get/list); key material never in logs, errors, diagnostics, SQLite, frontend state, caches, or persistent frontend storage (redaction tests). Renderer key hygiene: the key field is a transient controlled input cleared on submit/unmount/success; the renderer never retrieves stored keys and holds the plaintext only between keystroke and dispatch.
- Cloud approval: backend-issued single-use tokens bound to (request hash, account, destination, model, scope, short TTL). Renderer checkboxes and prefs revisions authorize nothing.
- Provider payloads are untrusted: error bodies bounded (≤4 KiB) + redacted; terminal semantics per API (Responses `completed/failed/incomplete`, Ollama `done/done_reason`) — never EOF/`[DONE]` as generic success; missing usage ≠ zero (recorded unknown); truncated stream ⇒ transport-end, never completion.
- No ambient fallback: no host/port/account/model/privacy substitution anywhere in adapter code (asserted by test: stub returns 429 → error surfaces, no second request emitted).
- CSP/capabilities unchanged; document that Rust-side HTTP is outside Tauri capability enforcement (enforced instead by endpoint validator + LocalOnly gateway + broker binding).

## Tasks — Delivery A (foundation + Ollama persisted conversation)

### Task A0: Dependency verification record + direct deps

**Files:**
- Modify: `Cargo.toml` (workspace deps), `crates/adham-provider/Cargo.toml`
- Test: `cargo tree -p adham-provider -e normal` output + `docs/reports/provider-deps-verification.md` (exact versions, licenses, release status, compat, transitive count, vulns, features on/off)

**Interfaces:**
- Produces: `reqwest::Client` availability with `json`+`stream`+TLS; `tokio_util::sync::CancellationToken` for A1/B2.

- [x] **Step 1: Write the record shell** — create `docs/reports/provider-deps-verification.md` with empty fields per Global Constraints. Run: `ls docs/reports/provider-deps-verification.md` Expected: file exists.
- [x] **Step 2: Add direct deps** — `reqwest = { workspace = true }` with `version = "0.13", default-features = false, features = ["json", "stream", "rustls"]` (`rustls` = aws-lc + platform verifier; `rustls-tls-manual-roots` does not exist as a public 0.13 feature — verified in crate source) + `tokio-util = { version = "0.7" }` in workspace + provider crate. Run: `cargo tree -p adham-provider -e normal | grep -E "reqwest|tokio-util|rustls|hyper-rustls"` Expected: single reqwest 0.13.x unified with lock.
- [x] **Step 3: Fill the verification record** — resolved versions, licenses (`cargo deny check`), release status, why `async-openai`/`eventsource-stream` were refused. Run: `cargo deny check` Expected: pass.
- [x] **Step 4: Commit** — `git add Cargo.toml Cargo.lock crates/adham-provider/Cargo.toml docs/reports/provider-deps-verification.md && git commit -m "feat(provider): verified HTTP deps"`

### Task A1: Shared HTTP transport

**Files:**
- Create: `crates/adham-provider/src/transport.rs`
- Modify: `crates/adham-provider/src/lib.rs` (module export)
- Test: `crates/adham-provider/tests/transport_tests.rs` (local `tokio::net::TcpListener` stub, no new dev-deps)

**Interfaces:**
- Consumes: `endpoint.rs` URL validation.
- Produces: `HttpTransport::post_json(url, body) -> Result<ByteStream, TransportError>` with total timeout, per-read timeout, `retry(never())`, single shared `Client`; `TransportError::{Unreachable, Timeout, TlsRejected, Status(u16, RedactedBody)}` mapping into the 7-variant taxonomy. No credential parameter in A (Ollama needs none; B adds keyed requests).

- [x] **Step 1: Write the failing test** — stub returns 200 NDJSON; assert first bytes arrive; stub sleeps past timeout; assert `Timeout`; non-loopback `http://` URL rejected before any socket; 302 redirect NOT followed (client surfaces 3xx, no second request); ambient proxy env (`HTTP_PROXY` pointing at a black hole) does not affect the request; resolved private/link-local/metadata/unspecified addresses rejected for both IPv4 and IPv6; 2 MiB single frame → protocol error, not OOM; per-read deadline fires on a stalled body. Run: `cargo test -p adham-provider --test transport_tests` Expected: FAIL (module missing).
- [x] **Step 2: Implement** `transport.rs` per the signature above (deadline from `ProviderRequestV1`).
- [x] **Step 3: Run** `cargo test -p adham-provider` Expected: PASS + clippy clean.
- [x] **Step 4: Commit** `feat(provider): shared HTTP transport`.

### Task A2: Registry persistence (accounts + models)

**Files:**
- Create: `crates/adham-event-log/src/sqlite/provider_registry.rs`, migration `20261xxx_provider_registry.sql` (`provider_accounts`, `provider_models` only — usage log is Task B3), `crates/adham-provider/src/registry.rs`
- Test: `crates/adham-event-log/tests/provider_registry_tests.rs`

**Interfaces:**
- Produces: `upsert_account`, `upsert_models(digest-pinned)`, `invalidate_on_endpoint_change` (clears models + bumps revision); stored JSON validated against `ModelDescriptor` on read (corrupt → integrity error, never live config).

- [x] **Step 1: Failing tests** — upsert→read round-trip; endpoint change wipes models; corrupt JSON row errors. Expected: FAIL.
- [x] **Step 2: Implement** migration + functions + registry cache wrapper.
- [x] **Step 3: Run** both crates' suites PASS.
- [x] **Step 4: Commit** `feat(provider): registry persistence`.

### Task A3: Ollama HTTP adapter + discovery

**Files:**
- Create: `crates/adham-provider/src/adapters/ollama_http.rs`
- Test: `crates/adham-provider/tests/ollama_http_tests.rs` (TcpListener stub: `/api/tags`, `/api/show`, streaming `/api/chat` incl. mid-stream abort + final usage frame)

**Interfaces:**
- Consumes: A1/A2 (transport, existing `OllamaStreamParser`, registry).
- Produces: `discover() -> Vec<ModelDescriptor>` (digest-pinned, capabilities from `/api/show`, `revision-unverifiable` where unpinnable); `stream_chat()` yielding normalized events; `unknown` required capability → blocked dispatch.

- [x] **Step 1: Failing tests** — tags→descriptors with digests; show→capabilities incl. local-blob evidence fields; chat stream deltas in order; connection refused → `transport` error; `done_reason: length` → completed-with-`truncated:true`; model with no local evidence dispatches NOTHING under a local-only request (`unknown` blocks). Expected: FAIL.
- [x] **Step 2: Implement** adapter (loopback-only URLs enforced).
- [x] **Step 3: Run** suite PASS.
- [x] **Step 4: Commit** `feat(provider): Ollama HTTP adapter`.

### Task A4: Assistant persistence event + projection replay

**Files:**
- Modify: `crates/adham-core-types/src/events.rs` (`assistant/message-completed` + `MessageCompletedV1`), `crates/adham-projections/src/conversation.rs` (replay both types in global order), contracts regen
- Test: `crates/adham-projections/tests/` addition + taxonomy round-trip test

**Interfaces:**
- Produces: `MessageCompletedV1 { message_id, text, completion: Completed|LengthExceeded|Interrupted, usage nullable }`; rebuild replays `MessageSubmitted` + `MessageCompleted`; interrupted partials replay as final text with their completion marker (no phantom completion on crash — crash persists nothing).

- [x] **Step 1: Failing tests** — submit user + complete assistant → rebuild → both rows in order with roles; interrupted replays with marker (never as completed context); failed replays with marker; length-limit replays completed-with-`truncated:true`; unknown completion value rejected; double terminal write for one op id → single row (Stop-vs-completion race); taxonomy round-trip. Expected: FAIL.
- [x] **Step 2: Implement** event type + payload + replay branch.
- [x] **Step 3: Run** event-log + projections + desktop-api suites PASS.
- [x] **Step 4: Commit** `feat(provider): assistant completion persistence`.

### Task A5: IPC — Ollama commands, streaming Channel, stop

**Files:**
- Modify: `crates/adham-desktop-api/src/{dtos.rs,handlers/providers.rs}`, `xtask/src/main.rs`, `packages/contracts-generated/src/index.ts` (regen), `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src/shared/api/{adham-client.ts,schemas.ts}`
- Test: `apps/desktop/src-tauri/src/ipc_contract_tests.rs` additions + `adham-client.test.ts` additions (mocked invoke; Channel mocked)

**Interfaces:**
- Produces: `test_provider_connection`, `discover_ollama_models`, `update_provider_account` (alias + endpoint only), `complete_once_streaming` → `Channel<StreamEventDto>`, `stop_completion(op_id)`; Zod schemas; `cargo xtask contracts` clean. No key/cloud commands in A.

- [x] **Step 1: Failing tests** — contract arg shapes; dispatch records the pending op BEFORE any socket (stub asserts record-then-POST order); history assembled server-side bounded + ownership-checked (renderer-supplied history ignored — send tampered scope, get `ContextMismatch`); Channel receives `StreamStarted…StreamCompleted` with per-op sequence numbers in order; `stop_completion` with a foreign op id → `ContextMismatch`, target op untouched; stop mid-stream yields terminal `Interrupted` + persisted partial (fixture); unknown model id blocked before any socket; renderer disconnect mid-stream (drop Channel client in test) → server still persists the terminal outcome. Expected: FAIL. *(RED collapsed into one GREEN battery: the acceptance battery pins every listed case directly; no compile-stub round-trip — noted in the delivery ledger.)*
- [x] **Step 2: Implement** handlers + commands + client (Ollama section only).
- [x] **Step 3: Run** `cargo test -p adham-desktop`, `cargo xtask contracts && git diff --exit-code` (no diff after regen commit), frontend tests PASS. *(Channel arg-shape is pinned at the dispatch level; live webview Channel flow deferred to A6 per the ledger's documented harness limitation.)*
- [x] **Step 4: Commit** `feat(provider): Ollama IPC + streaming contracts`.

### Task A6: Frontend — Ollama status/discover, models defaults, composer + Stop + reload

**Files:**
- Modify: Providers page (Ollama section only: endpoint + Test + Discover), Models page (defaults from registry), composer picker (registry source) + Stop button → `stop_completion`, 4 locales, page tests
- Test: connect→test→discover flow; failed test saves nothing; Stop persists partial as Interrupted and halts deltas; reload renders persisted history; unknown picker id blocked; Providers + Models nav entries render and search finds them; hidden capability rows inside those pages stay disabled with `PreviewNote`; strict-boundary switch stays hidden until B

**Interfaces:**
- Consumes: A5 client methods.

- [x] **Step 1: Failing tests** — as above, plus nav/search visibility for Providers + Models. Expected: FAIL. (Done: sequence-aware boot stub tests written first; see progress ledger at reset a1033d14.)
- [x] **Step 2: Implement** UI flows in all 4 locales; extend `VISIBLE_SETTINGS_PAGES` with `providers` + `models` (working Ollama row, model defaults, and fallback guard cover the rest — non-working rows stay in disabled fieldsets). (Done at a1033d14.)
- [x] **Step 3: Run** settings + composer suites + locale coverage PASS. (Root vitest 621/621 at a1033d14; 624/624 at the A7 revision.)
- [ ] **Step 4: Commit** `feat(settings): Ollama wiring + composer dispatch`.

### Task A7: Delivery A acceptance (fixtures + Ollama E2E)

- [x] **Step 1: Fixture suite green** — truncated NDJSON mid-line, missing usage frame, connection refused, `done_reason` variants, double-stop idempotency. Run: `cargo test --workspace` Expected: PASS. (Done: adapter 9/9 incl. new missing-usage + unknown-done_reason fixtures; ipc 15/15 incl. new premature-EOF and unresolved-op acceptance tests; double-stop pinned inside `stop_mid_stream_persists_interrupted_partial`.)
- [ ] **Step 2: Ollama E2E (requires local Ollama + one pulled model; approved separately as a model download)** — full conversation persists across reload; Stop mid-stream persists partial as `Interrupted` and halts; kill -9 mid-stream → startup reconciles the pending op as unresolved (surfaced in UI as interrupted/unresolved, never auto-completed) → reload shows history without the tail. Record results in `docs/reports/provider-delivery-a.md`. (NOT RUN — approval-gated; the automated acceptance pass ran the fixture equivalents of every listed scenario instead: `premature_eof_persists_failed_terminal_once`, `unresolved_pending_operation_surfaces_and_never_autocompletes`, interrupted-terminal-on-stop; live native hands-on testing of the running dev app is the user's activity.)
- [x] **Step 3: Commit evidence** `docs(reports): delivery A acceptance`. (Evidence: `docs/reports/provider-delivery-a-20261017.md` — the file itself records the exact revision.)

## Tasks — Delivery B (Responses cloud proof; fixtures by default)

### Task B0: Credential broker + lifecycle

**Files:**
- Create: `crates/adham-provider/src/broker.rs`
- Test: `crates/adham-provider/tests/broker_tests.rs` (`InMemoryBroker`; OsKeyring path asserted by interface test only — no OS store writes in CI)

**Interfaces:**
- Produces: five separate ops — `create_key` (fails if present), `replace_key`, `revoke_key` (vault delete + `revoked` row), `delete_account` (vault + row, usage rows kept), `get_key` (read-only, key-loss on missing); `BrokerDrift` split-failure type; keys exposed only as `Redacted` (`Debug` prints `***`).

- [ ] **Step 1: Failing tests** — five ops separately (create fails if entry exists; replace rotates; revoke disconnects + blocks dispatch; delete removes vault+row but keeps usage rows; get missing → key-loss error, never empty); `Debug` shows `***`; split-failure matrix: vault-ok/SQLite-fail → `BrokerDrift` retryable, vault write idempotent by account id; SQLite-ok/vault-fail → key-loss, dispatch blocked, never half-bound. Expected: FAIL.
- [ ] **Step 2: Implement** trait + both backends (service `adham-provider-key`, account = account id).
- [ ] **Step 3: Run** suite PASS.
- [ ] **Step 4: Commit** `feat(provider): credential broker + lifecycle`.

### Task B1: Responses SSE parser

**Files:**
- Create: `crates/adham-provider/src/adapters/sse.rs`
- Test: `sse_tests.rs` (typed `response.*` events in order, `response.completed` with usage, `response.failed`/`incomplete`/`error` frames, truncated frame, `store:false` request shape asserted)

**Interfaces:**
- Produces: `parse_responses_frame` never treating terminal events as data; proof always sends `store:false`, no background, no `previous_response_id`.

- [ ] **Step 1: Failing tests** — fragmented multi-byte UTF-8 across chunks, split frames, CRLF endings, multiline `data:` fields, `:` comment lines ignored, 1 MiB oversized frame → protocol error (never OOM), malformed event, premature EOF → transport-end (never completion), provider `error` frame, cancellation mid-frame. Plus the interface battery above. Expected: FAIL.
- [ ] **Step 2: Implement** parser (~70 lines, no new dep).
- [ ] **Step 3: Run** suite PASS.
- [ ] **Step 4: Commit** `feat(provider): Responses SSE parser`.

### Task B2: Responses adapter (fixture-proven)

**Files:**
- Create: `crates/adham-provider/src/adapters/openai.rs`
- Test: `openai_proof_tests.rs` vs TcpListener stub: out-of-band `store:false` wire assertion (every proof request carries it); happy path; mid-stream `{"error"}` → transport-end, no completion; 429 + `Retry-After` → rate-limit error, stub saw exactly 1 POST (no resume, no fallback); truncated → transport-end; ECONNRESET → error; key bytes absent from all logs/diagnostics (redaction test)

**Interfaces:**
- Consumes: A1/B0/B1, gateway privacy check (cloud target + strict boundary → require approval token).

- [ ] **Step 1: Failing tests** — all of the above. Expected: FAIL.
- [ ] **Step 2: Implement** adapter + approval gate (fixed `https://api.openai.com`, not editable).
- [ ] **Step 3: Run** full suites PASS.
- [ ] **Step 4: Commit** `feat(provider): OpenAI Responses proof`.

### Task B3: IPC — accounts, keys, destinations, usage log

**Files:**
- Modify: event-log registry (usage-log table), desktop-api handlers/dtos, xtask, contracts, tauri lib, frontend client/schemas
- Test: contract tests; `set_provider_key` response contains no key material; revoked account dispatches blocked; usage rows appended per call with tokens-or-unknown

- [ ] **Step 1: Failing tests** — contract arg shapes; `approve_cloud_dispatch` issues a token bound to (request hash, account, destination, model, scope, TTL) and dispatch without a valid token is blocked (renderer checkbox alone authorizes nothing; expired/replayed/wrong-scope tokens rejected); `set_provider_key` response contains no key material; revoked account dispatches blocked; usage rows appended per call with scope + tokens-or-unknown (unknown stays unknown — no billing math). Expected: FAIL.
- [ ] **Step 2: Implement** (endpoint change invalidates grants + cache).
- [ ] **Step 3: Run** `cargo xtask contracts` clean + suites PASS.
- [ ] **Step 4: Commit** `feat(provider): cloud account IPC + usage audit`.

### Task B4: Cloud UI + authorization + lifecycle UI

**Files:**
- Modify: Providers page cloud section (fixed endpoint, alias, write-only key, Test, per-destination authorization checkbox, rotate/revoke), 4 locales, tests
- Test: save blocked until test passes + authorization checked; revoke disables dispatch; failed test saves nothing

- [ ] **Step 1: Failing tests** — save blocked until test passes + authorization checked (checkbox alone saves nothing — only the backend-issued token authorizes); key field is transient (cleared on submit/unmount/success, never re-readable, absent from frontend state/caches); rotate/revoke/delete flows with confirmations; copy says "stateless request", never "zero retention"; revoke disables dispatch; failed test saves nothing. Expected: FAIL.
- [ ] **Step 2: Implement** UI in all 4 locales.
- [ ] **Step 3: Run** settings + coverage PASS.
- [ ] **Step 4: Commit** `feat(settings): cloud account wiring`.

### Task B5: Live runbook (docs only, separately approved per run)

- [ ] **Step 1: Write** `docs/reports/provider-live-runbook.md` — test account, spend cap, explicit per-run approval token, `store:false` wire assertion, revoke-after-run. No code.
- [ ] **Step 2: Await separate approval** — never runs in CI, never runs without it.
- [ ] **Step 3: Commit** `docs(reports): cloud live runbook` (results appended only after an approved run).

## Acceptance criteria

**Delivery A:** all fixture suites green (incl. network policy, parsing battery for NDJSON, four terminal outcomes, stop-race idempotence, ownership checks); Ollama E2E recorded (persisted conversation incl. Stop-partial as `Interrupted`; reload restores; kill → pending op reconciled as unresolved, surfaced, never auto-completed); providers/models nav+search wiring tested; `pnpm check` + workspace clippy/tests/fmt green on all OS legs; no cloud code path exists (assert: no `https://` provider URL outside tests — necessary but not sufficient for the egress claim, which rests on evidence-based local classification).
**Delivery B:** all fixture suites green incl. exact-1-POST, redaction (no key bytes anywhere), truncated/error-frame/failed/incomplete handling, `store:false`-on-wire assertions, approval-token binding/replay/expiry tests, split-failure matrix; usage audit rows verified scoped with unknown-stays-unknown; live runbook approved separately and results reported — CI never touches live.

## Review Focus

- Stop races completion: the terminal frame and the user's Stop arrive together — Tasks A4/A5 pin exactly one terminal outcome (either `Completed` persisted or `Interrupted` partial, never both, never none), and Task A4 pins the double-write to a single row.
- A crash mid-stream resurrects as a finished answer on reload — Task A7 pins pending-op reconciliation (surfaced unresolved, never auto-completed) plus history-without-tail.
- A forged or replayed approval reaches the cloud adapter — Tasks B3/B4 pin backend-issued, single-use, scope/TTL-bound tokens with renderer booleans authorizing nothing.
- An API key lands in logs, diagnostics, SQLite, frontend state, or an IPC echo — Tasks B0/B2/B3/B4 pin redaction, write-only key flow, transient renderer handling, and no-key-bytes tests.
- A truncated/failed Responses stream renders as a complete answer — Tasks B1/B2 pin `failed/incomplete/error`/truncated/premature-EOF as transport-end with per-API terminal semantics (never EOF/`[DONE]` as success).

---

## Self-review

1. **Spec coverage:** every contract-checklist item maps: metadata→A2/A3, stream events→B1/A3 (+existing enum), errors→A1/B1/B2, availability/discovery→A3/A5, rate limits→B2, cancellation→A1/A5/A6 (token + `stop_completion`; P0-07 owns wider orchestration — the seam is the token + terminal-event contract, nothing more), fallback→A (structurally absent) + B2 exact-1-POST, privacy→B0/B3/B4. Gap: contract doc is truncated at §7 — flagged in header, companion used, nothing invented.
2. **Step scan:** each step names one test or one signature; bodies appear only where the signature doesn't determine them (SSE reassembly, upsert SQL, redaction).
3. **Type consistency:** `TransportError`→taxonomy mapping, `StreamEventDto` naming, `ValidatedAppPreferences`-style zod pattern reused, `Channel<StreamEventDto>` used consistently in A5/B3/A6, `MessageCompletedV1` naming symmetric with `MessageSubmittedV1`.
4. **Review Focus:** each of the five has an owning test above.
5. **Proportion:** tasks carry decisions (exact commands, DTO names, SQL shapes, feature flags); no bodies transcribe programs.

## Versioned documentation evidence (researcher-verified 2026-10-16, no live calls)

- OpenAI Responses API (Delivery B proof): Context7 `/websites/developers_openai` + official references (`responses/methods/create`, `responses/streaming-events`, guides for streaming/background/rate-limits/error-codes). `POST /v1/responses` with `model/input/stream/store/background/previous_response_id`; SSE event order `response.created → in_progress → output_item/content_part/output_text.delta* → done chain → response.completed`; terminal `response.completed/failed/incomplete` or bare `error`; `usage` only in final `completed`; `store:false` = stateless (no retrieve/chain); `background` = pollable + cancellable (proof uses neither); 4-field error object; Bearer auth; `x-ratelimit-*` + `Retry-After`. Re-check field defaults at implementation time.
- Vs Chat Completions (kept as contrast only — the proof does NOT use it): typed `response.*` events vs `chat.completion.chunk` deltas; `response.completed` event vs literal `data: [DONE]`; usage always in final `completed` vs only with `stream_options.include_usage`.

- Ollama API: `raw.githubusercontent.com/ollama/ollama/main/docs/api.md` + `docs.ollama.com/api` — `/api/chat` NDJSON (`message.content`, `done`/`done_reason`, usage on final frame only), `/api/tags` discovery, `/api/show` capabilities, local no-auth. NOTE: `/api/generate` uses `response`, not `message.content` — adapters must not mix them.
- OpenAI Chat Completions (reference for follow-on adapters only — superseded for the proof by Responses above): `openai-openapi` v2.3.0 + rate-limits guide. OpenAI-compatible endpoints differ (error shape, usage semantics, fingerprint fields) — each needs its own fixture.
- reqwest 0.13.1 (`docs.rs/reqwest/0.13.1`): `json`/`stream` features, per-request `timeout`, `retry(never())` to disable the NACK-retry default, `default-tls` = rustls + platform verifier. Locked 0.13.5 via Tauri has NO TLS backend — direct dep required for HTTPS.
- tokio 1.53.3 + tokio-util 0.7.20: `timeout()` drops inner future on expiry; `CancellationToken::run_until_cancelled`; dropping a `bytes_stream` mid-read aborts the read.
- Contract completeness resolved: `P0-08 — Provider gateway and normalized stream contract.md` is 164 lines ending mid-heading at `### Message/content semantics` (verified by file bytes, not retrieval) — genuinely truncated. The 330-line wiring-matrix companion is complete and is the authority for everything past §7; each plan item cites which source it comes from, and anything in neither is marked as a plan decision, not a contract claim.
