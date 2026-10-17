# Google Gemini Cloud Adapter — Bounded Implementation Plan (Delivery G)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (provider
> teammate executes in this workspace) to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Gemini as the FIRST cloud adapter (replacing the gated OpenAI
Responses "Delivery B") by reusing the provider-neutral contracts — Google-specific
discovery, authentication, requests, streaming and errors live inside one adapter
module; the shared conversation orchestration never parses Gemini.

**Spec inputs:** user directive 2026-10-17 (cloud adapter instead of OpenAI + proof
obligations); the Delivery-B authorization architecture inherited from
`docs/superpowers/plans/2026-10-16-provider-model-integration.md` (vault, consent,
approved_destination, copy rules — supersession noted there); capability-handoff
additive-contract proposal (`docs/reports/provider-capability-handoff-20261017.md`);
#32 ownership split (composer/conversation side stays theirs).

## Architecture decisions (fixed before coding)

- **Reuse, don't fork.** `ProviderRequestV1` + `NormalizedStreamEvent` +
  `ModelSelectionSnapshot` + `PinnedModel`/`ModelDescriptor` + the `run_stream` event
  loop in `handlers/providers.rs` are provider-neutral already. The only
  Ollama-specific parts of the dispatch path are the `ProviderKind::OllamaLocal`
  validation gate, the `ollama_adapter()` factory and `resolve_pinned`'s digest
  semantics. Generalizing those three points is the whole integration delta.
- **One adapter module.** `crates/adham-provider/src/adapters/gemini_http.rs` owns
  all Gemini wire knowledge (host, `v1beta` paths, `x-goog-api-key` header, SSE
  parsing, error JSON, frame mapping). Nothing else in the repo learns Gemini
  strings except this module, its tests, and the frontend's UI **labels** (never
  parse/conditions).
- **Adapter selection is data-driven.** `ProviderKind::GoogleGemini` (new serde
  variant, Rust-internal only — `kind` is not in the account DTO today) added to
  `domain/account.rs`; dispatch matches on `account.kind`. No frontend model arrays,
  no model-name conditions anywhere; all model rows/capabilities come from
  discovery → registry → DTO.
- **Streaming handle as enum, not trait-object.** `AnyAdapter{
  Ollama,Gemini }` + `AnyStream{…}` with a shared `next_event() -> Option<Result<
  NormalizedStreamEvent, ProviderError>>` — no async-trait dep, Ollama diagnostics
  stay intact, orchestration keeps consuming `NormalizedStreamEvent`.
- **Credentials in Rust, never rendered.** Dedicated `provider_credentials` table
  (adham-event-log, AEAD-encrypted via the durable content-key envelope, keyed by
  account_id, never in `provider_accounts`, never exposed by `list_provider_accounts`
  or any success response — legacy note "no secrets in any table" pinned to the
  registry tables, not the vault). The frontend supplies the key once
  (write-only command); the card shows presence-only state afterwards.
- **Endpoint / scope / transfer authorization.**
  - Endpoint: `EndpointDescriptor::validate_url` (HTTPS-only for non-loopback) +
    adapter hard allowlist `https://generativelanguage.googleapis.com` — no user
    override in this delivery.
  - Transfer authorization: account minting refuses without an explicit
    `acknowledge_cloud_transfer` consent flag; `approved_destination=true` and
    `privacy_class=CloudStandard` persist only through that path; the Ollama loopback
    guard and this adapter's Cloud-and-official-host-only guard are mirrors.
  - The Delivery-B single-use approval-token subsystem (`approve_cloud_dispatch`)
    is the next hardening ring AFTER #32 ships composer consent UX — the bounded
    delta ships consent + host allowlist + no-token-override; nothing dispatches
    without the consented account.
- **Per-state separation.** Account configuration = `provider_accounts` (+ vault
  ref), health/discovery = adapter probes recorded in-session exactly like the
  Ollama card states (session-local, timestamped, endpoint-guarded — no new
  persistence), per-operation state = the existing durable pending-operation row +
  `completion_runs` cancellation map + terminal persistence. No new blending.
- **Bounded context: model list paging** — first page only (`pageSize=200`); more
  pages recorded as a known limit, not silently truncated claims.

## Gemini wire specifics (re-verify at implementation time; v1beta, SSE)

- Discovery: `GET {base}/v1beta/models` (`pageSize=200`), `x-goog-api-key` header —
  **never a URL query parameter** (no key in URLs/logs).
- Health: same models list with `pageSize=1` (metadata-only, non-billable).
- Streaming: `POST {base}/v1beta/models/{model}:streamGenerateContent?alt=sse`;
  body maps `ChatMessage` roles (`system`→`systemInstruction`, `user`→`user`,
  `assistant`→`model`; consecutive system rows collapse) + `generationConfig`
  (`maxOutputTokens`, `temperature` — mirroring Ollama's option pass-through).
- Frame mapping: SSE `data:` JSON chunks →
  `part.thought==true` → `ThinkingDelta` (contract field exists today), else
  `TextDelta`; `finishReason` STOP→`Stop`, MAX_TOKENS→`LengthExceeded`,
  SAFETY/**BLOCKLIST**/PROHIBITED_CONTENT/SPII/RECITATION→`ContentFilter`,
  unknown/absent→`Interrupted` (fail-closed mapping); `usageMetadata` →
  `Progress` passed through field-for-field (no arithmetic).
- Errors: pre-stream `error.{code,message,status}`; 401/403→auth, 429→quota (no
  auto-retry), 5xx/transport→transient — mapped to `ProviderError`, mid-stream SSE
  error frame or aborted call → `Err` through `next_event` (the run_stream loop's
  existing failure path handles it).
- Capability evidence mapping (backend data only): `generateContent` in
  `supportedGenerationMethods` → `completion: Supported`, else `Unsupported`;
  `streamGenerateContent` → `streaming` (else `Unsupported`); thinking / tools /
  vision / structured_output stay **unknown — no wire evidence in models.list**;
  embedding models are listed with honest `Unsupported` completion. `inputTokenLimit`
  /`outputTokenLimit` recorded once the coordinated descriptor additive lands
  (`context_length_declared`), unknown until then.

## Global constraints

- No new dependencies (Rust or npm). SSE = manual `data:` line parsing over the
  existing `HttpTransport`; test stubs = inline `tokio::net::TcpListener` spawners
  (pattern from `ollama_http_tests.rs`).
- No cloud calls, no real keys, no push/merge. Cloud egress code is exercised only
  against local TCP-stub fixtures; live runs are separately approved later.
- No OpenAI work; `OpenAiCompatible` kind untouched/probably unused.
- Composer/conversation features belong to #32 — their files only gain generated
  types and unchanged-by-them tests; my delta adds no conversation parsing.
- Gates after each code task: `cargo test --workspace --locked`, clippy, fmt; full
  `pnpm check` (contracts regen via the owning generator only — never hand-edit).

## Review focus

1. **Independence:** every Google path must be reachable while NO Ollama endpoint is
   alive, and every Ollama failure terminal must dispatch nothing to Google
   (selection is by the op's own account only — no fallback code path exists).
2. **Orchestration crash-safety:** malformed frames/network aborts from either
   adapter map to failed/interrupted terminals; panic-free is pinned with
   malformed-response regression tests (the `5d74097` lesson).
3. **No Gemini in conversation layers:** vitest architecture test scans
   `src/features/conversation` + `src/widgets/compose` for
   `gemini|generativelanguage|streamGenerateContent` and asserts absence.
4. **Secret handling:** key bytes appear in exactly one table (AEAD), zero DTOs,
   zero logs, zero error strings; `GoogleApiKey` redacts itself in
   Debug/Display/serde-serialized diagnostics.
5. **Unknown stays unknown:** no fabricated capabilities or context values; the
   managed-provider matrix renders record-only chips.

## Cross-check vs yoagent (external framework, 2026-10-17)

Compared against a mature multi-provider agent framework (7 protocols —
Anthropic/OpenAI(a,b,c)/Azure/Google(GenAI,Vertex)/Bedrock — `StreamProvider`
trait, retries, presets, wasm). Neither side is "wrong": they are an
SDK where the developer hands over `ModelConfig` (explicit `reasoning`,
`context_window`, quirk flags); Adham is a security-first desktop client whose
capability evidence must come from the wire. Adopted/flagged changes to this plan:

- **Absorb — mid-stream failure semantics (G-Task 3 fixture set):** a stream that
  ends or drops before any `finishReason` is a distinct "clean-end/drop" case
  handling; a drop AFTER a finishReason keeps the response (no double billing);
  503/`UNAVAILABLE` honors `Retry-After`, while 429/`RESOURCE_EXHAUSTED` stays
  non-retried by our policy; `MALFORMED_FUNCTION_CALL`-family ends as a failed
  terminal with `finishMessage` in the reason; `promptFeedback.blockReason` and
  the `SAFETY`/`PROHIBITED_CONTENT`/`BLOCKLIST`/`SPII`/`IMAGE_SAFETY` family end
  as `ContentFilter`. Their header-history note ("key moved out of URL because
  transport errors could echo it") is external confirmation of the
  `x-goog-api-key`-header-only decision already fixed here.
- **Absorb — request-control design margin (follow-up, #32-coordinated):** when
  thinking controls ship, the control field/level choice must be evidence-driven
  (the coordinated `thinking_control` additive + optionally a live-probed
  acceptance matrix), NOT parsed from model ids the way they parse
  `gemini-<major>` version rules. Their `MINIMAL`-acceptance matrix and
  "both-levels-in-one-request errors" caution go into that follow-up's spec.
- **Do not adopt:** env-var API-key resolution (desktop-weak: plaintext keys in
  process env; our model is explicit consented vault storage, key never renders),
  name-derived capability/context presets (violates the no-model-name-conditions
  spec rule for a discovery-first client — their presets are developer-declared
  config, legal there), and auto-retry loops (violate the no-auto-fallback/no-
  auto-retry policy; user-driven retry belongs to #32's composer plan).
- **Different-by-design:** their breadth (7 protocols), per-provider quirk flag
  structs, OpenAI-compat transport for Ollama, and channel-based
  `StreamProvider` trait — vs our narrower trusted set, native Ollama protocol
  (digest pinning + thinking-frame robustness), enum dispatch, vaulted creds,
  idempotent receipts, event-sourced durable ops, bounded/AEAD content.

## Tasks

### G-Task 1: Contract variant + account DTO additive (coordinate note)
- [ ] Step 1: `domain/account.rs`: `ProviderKind::GoogleGemini` (serde `google_gemini`);
      fix every non-exhaustive match compile error outside the provider crate
      (expected: the `matches!` gate in `handlers/providers.rs` only).
- [ ] Step 2: `ProviderAccountDto` gains `#[ts(optional)] kind: ProviderKind`
      (additive; regen contracts via the owning generator). Ledger note to #32.
- [ ] Step 3: providers.rs `local_account` gate generalized (kind match below).
- [ ] Gates: cargo + affected frontend suites.

### G-Task 2: Credential vault (backend only)
- [ ] Step 1: failing tests → `crates/adham-event-log/src/sqlite/provider_credentials.rs`:
      `provider_credentials` table (`account_id` PK, AEAD ciphertext, record meta),
      `put/get/remove` through the existing content-key envelope; unique
      account_id; old rows unaffected (separate table).
- [ ] Step 2: registry-facing accessor on ApiContext (load key into memory per
      dispatch, never cached beyond the call, dropped after adapter use).
- [ ] Step 3: IPC surface: `configure_google_account` (write-only alias+key+consent;
      consent flag false/absent → `VALIDATION_FAILED`, nothing saved), key rotation
      (re-put), disconnect (remove key + keep account row? choose: remove both row
      and key — account delete parity with Ollama).

### G-Task 3: Gemini adapter module
- [ ] Step 1: failing fixture tests (TcpListener stubs from task 0 patterns):
      discovery mapping (generative + embedding rows), health, SSE happy path,
      thought/text mixing, finishReason matrix, quota/auth errors, truncated and
      malformed frames without panic, mid-stream connection drop, `x-goog-api-key`
      used (no query params), non-official host refused, non-Cloud selection refused.
- [ ] Step 2: `adapters/gemini_http.rs`: `GeminiHttpAdapter{transport, base_url,
      api_key: GoogleApiKey}` + `GeminiStream`; constructor reuses
      `EndpointDescriptor::validate_url` + host allowlist; `connection_test` +
      `discover()` map into `ModelDescriptor` per the capability table above.
- [ ] Step 3: wire `mod.rs`; privacy-boundary tests extended
      (`privacy_boundary_tests.rs`).

### G-Task 4: Dispatch generalization (+ proofs live here)
- [ ] Step 1: failing tests in `crates/adham-desktop-api/src/ipc_contract_tests.rs`
      (existing battery):
      1. `google_configure_and_discover_work_while_ollama_unreachable`
      2. `ollama_failure_terminal_dispatches_nothing_to_google`
      3. `gemini_midstream_error_maps_to_failed_terminal_and_history_read_survives`
      4. `unknown_model_or_missing_key_fails_closed_presession` (fail-closed, no
         pending op leak — pre-wire validation unchanged)
- [ ] Step 2: `AnyAdapter{Ollama,Gemini}` + `AnyStream` with shared
      `next_event()`; `flow_adapter(account, credential)`; run_stream stays
      byte-identical otherwise; `resolve_pinned` unchanged (cloud rows may have
      empty digest — the local-only digest guard already blocks them from local
      dispatch and vice versa).
- [ ] Step 3: same battery green; Ollama 16-test battery untouched.

### G-Task 5: Provider settings surface (backend-driven only)
- [ ] Step 1: failing vitest specs (providers-page test file patterns):
      Google card = consent checkbox + write-only password key input (cleared on
      unmount/submit — old B-plan copy rules) + Test/Discover with the SAME
      endpoint-guarded state discipline as the Ollama card (configured / inventory
      restored / timestamped last check / discovery result / distinct errors),
      official-host display is not editable.
- [ ] Step 2: `ollama-models.tsx` generalized to `provider-models.tsx`: per-account
      sections from `providerAccounts` × `providerModels` (all kinds — no
      name/prefix conditions); row rendering rules unchanged.
- [ ] Step 3: composer untouched (cloud dispatch proof stays backend/IPC-level until
      #32 wires the cloud-capable composer; the LOCAL composer needs zero changes).

### G-Task 6: Docs, evidence, coordination
- [ ] Step 1: full gates; evidence report `docs/reports/provider-delivery-g-YYYY-MM-DD.md`
      (delta list, proofs, limitations).
- [ ] Step 2: ledger; coordination handoff to #32 (DTO kind field + descriptor
      additive + ThinkingDelta surfacing proposal + composer cloud model plan).
- [ ] Step 3: live-run runbook for later approval (real key, spend cap, per-run
      approval) — drafted, not executed.

## Self-review notes

- The four proof obligations map to named tests in G-Tasks 3, 4 and Review Focus 3.
- Shared-stream contract gains nothing in G1 except passes-through ThinkingDelta
  (already in the contract); no streaming DTO change is required for this delivery —
  ThinkingDelta surfacing is a #32-coordinated follow-up, kept aligned with the
  capability handoff.
- Ownership boundaries (per #32's note) are respected: branches/worktrees for the
  job, shared files listed per task, provider wire protocol knowledge confined to
  `gemini_http.rs`.
