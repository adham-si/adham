# Delivery G acceptance — Google Gemini provider adapter + surfaces (fixture transport)

- **Date**: 2026-10-17
- **Final revision**: `d2808b0` (G5). Commit chain: G1 `99632a5` → G2 `0583710` → G3 `4b309f1` → G4 `427eb5c` → G5 `d2808b0`.
- **Scope of this report**: **automated** acceptance only. The gated live-Gemini run (plan Task 6 Step 3) was **not** executed — it requires owner approval for a real API key (runbook below, drafted only). Every live scenario has an automated fixture equivalent pinned here; all data is disposable synthetic.

## Delta list (adopted changes + frozen-plan deltas)

Adopted per plan:

1. **G1** — `ProviderKind::GoogleGemini` (serde `google_gemini`); `ProviderAccountDto.kind` required additive field everywhere (Rust DTO + zod regen + TS).
2. **G2** — `provider_credentials` vault table; AEAD seal through the existing content-key envelope with AD = purpose + installation + account id; `configure_google_account` / `disconnect_google_account` (account row delete → CASCADE wipes models + credential; cache dropped); write-only key: the response and every log envelope carry no key material; refusable errors surface only the public code (`VALIDATION_FAILED`) with detail asserted at handler level (not in envelopes).
3. **G3** — `crates/adham-provider/src/adapters/gemini_http.rs`: Google-specific wire knowledge confined to this module (transport policy: OFFICIAL-exact endpoint discovery, `x-goog-api-key` header auth; models-list discovery; SSE parse + finish-reason taxonomy; field-for-field usage accounting). Shared transports untouched except additive `*_with_headers` variants (P0 content path unmodified).
4. **G4** — `AnyAdapter`/`AnyStream` in `adapters/mod.rs` (the ONLY kind-branching point); per-dispatch sealed-credential; kind-routed discovery/test/dispatch proofs.
5. **G5** — settings surfaces: `GoogleConnect` card + `ProviderModelSections` (below) + client methods.

Frozen-plan deltas (recorded, deviations from the frozen plan text):

1. **G4**: the Google dispatch factory additionally admits a **loopback-mirror** base_url (needed so the four IPC proofs travel the REAL handlers/service path against `TcpListener` stubs; OFFICIAL host policy unchanged — external hosts still never construct).
2. **G5**: `cargo xtask contracts` regen was silently dropping the G2 DTO exports — the generator's TS inventory is a hand-maintained `::decl()` list in `xtask/src/main.rs` that G2 never extended. Fixed this task by adding the three G2 payloads; grep-verified in `packages/contracts-generated/src/index.ts`.
3. **G5**: `handle_test_provider_connection` now kind-routes (Google → `AnyAdapter::connection_test` with a per-call sealed credential; Ollama path unchanged) — same policy surface as dispatch.
4. **Flagged, NOT adopted**: v1beta `Model.thinking` boolean now documented by Google; the frozen plan pinned discovery to `supportedGenerationMethods` only. Mapping stays methods-only; the thinking field stays Unknown/unsurfaced until a coordinated decision.

## Scenario coverage → automated pins

Fixture tests: `crates/adham-provider/tests/gemini_http_tests.rs` (12), ipc battery `apps/desktop/src-tauri/src/ipc_contract_tests.rs` (google battery), frontend `providers-page.test.tsx` (4 Google specs) + `models-page.test.tsx` (2 G specs).

| Scenario (plan) | Automated pin |
| --- | --- |
| Discovery maps only `supportedGenerationMethods` (generateContent ⇒ streaming Supported; embeddings ⇒ non-streaming rows; others Unknown) | `discover_lists_generative_and_embedding_rows` |
| Connection test is metadata-only (never a billable generation; model counts from the models list) | `connection_test_counts_models_metadata_only` (+ ipc `google_configure_and_discover_work_while_ollama_unreachable`) |
| Happy stream: deltas → usage → exactly one Completed (prompt/completion/thoughts accounting; thoughts bill completion, usage totals authoritative, never recomputed) | `stream_emits_deltas_usage_and_stop_in_order` |
| Thought parts surface as ThinkingDelta without becoming visible text | `thought_parts_surface_as_thinking_deltas` |
| fail-closed termination matrix (STOP→Stop; MAX_TOKENS→LengthExceeded; SAFETY/RECITATION/BLOCKLIST/PROHIBITED_CONTENT/SPII→ContentFilter; promptFeedback block beats finishReason; MALFORMED_FUNCTION_CALL/unknown→Interrupted-not-Completed) | `finish_reason_matrix_maps_fail_closed` |
| Truncation/malformation never completes a stream | `malformed_and_truncated_frames_error_without_panicking`, `clean_eof_without_terminal_is_an_error` |
| Midstream transport error → Failed terminal, history read survives | `mid_stream_connection_drop_surfaces_transport_error` (+ ipc `gemini_midstream_error_maps_to_failed_terminal_and_history_read_survives`) |
| HTTP status errors → taxonomy, no retry storms | `http_status_errors_map_to_taxonomy` |
| Key never in query string; official-host policy | `api_key_travels_in_header_never_in_query`, `non_official_hosts_are_refused_without_a_socket` |
| Cloud selection refused outside cloud envelopes | `non_cloud_selection_refused_before_socket` |
| Configure/consent gate/rotate/disconnect cascade | ipc `google_account_configure_consent_rotation_and_disconnect` |
| Google works while Ollama is unreachable; failed Ollama side dispatches NOTHING to Google; unknown model/missing key fail closed pre-session (no pending leak) | ipc `google_configure_and_discover_work_while_ollama_unreachable`, `ollama_failure_terminal_dispatches_nothing_to_google`, `unknown_model_or_missing_key_fails_closed_presession` |
| Consent gate at the UI boundary: Connect disabled without the checkbox; key draft is write-only (type=password, cleared on submit, never a stored value); official endpoint display-only; two-step disconnect | providers-page.test.tsx: `connects only with explicit consent…`, `shows the official endpoint as read-only…`, `disconnects only after the two-step confirmation…`, `tests and discovers against the saved Google account by id` |
| Per-provider model sections with NO name/kind/prefix condition; empty digest ⇒ no sha256 row | models-page.test.tsx: `renders a section per connected account regardless of kind…`, `says nothing about connected providers when no accounts exist` |
| No plaintext content at rest (google battery reuses A7 leak scans) | leak scans on `events.payload_json` + `CAST(protected_bytes AS TEXT)` inside the google ipc battery |

## Gates at `d2808b0` (fresh, repo root, locked)

| Gate | Result |
| --- | --- |
| Vitest (root config, 55 files) | **637/637** |
| `pnpm typecheck` | clean |
| `cargo test --workspace --locked` | **367 passed**, 0 failed (94 ok suites; unchanged vs G4 `427eb5c` — the Google ipc battery shipped G2–G4; G5's Rust delta is handler routing only) |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 0 warnings |
| `cargo fmt --check` | clean |

## Remaining gaps / limitations

1. **Live Gemini run not executed** (owner-gated; runbook below). Fixture SSE/transport stubs cover the wire shape; real endpoint behavior (rate-limit reactions, content-block realism, latency) is unverified beyond fixtures.
2. **Connection test is metadata-only by design** — it cannot validate key *scopes* against billable generation. First real generation is the first billable test.
3. **ThinkingDelta reaching the renderer is a #32-coordinated follow-up** (surfacing placeholder; the stream DTO already carries it).
4. Composer cloud-model selection & retry UX is #32's lane (untouched here by design).
5. Extremely defensive posture kept: unknown stays unknown; no URL/model-name branching outside `gemini_http.rs`; external hosts never construct.
6. `settings.providers.unreachable` remains Ollama-scoped copy; the Google card uses the google-scoped line instead. Unused legacy keys are harmless accumulation.

## Coordination handoff to #32 (composer/messages/branches/retry UX owner)

- **Additive contract**: `ProviderAccountDto.kind: string` (required, G1) — treat as the ONLY acceptable branch discriminator; never branch on `endpointUrl` or model names. Zod + Rust contracts regen at `99632a5`/this revision.
- **Capability descriptors**: streaming is `Supported` for Gemini models whose discovery records `generateContent` in `supportedGenerationMethods`; every other dimension stays `Unknown` (tools, structured output, thinking budgets — no inference from names).
- **ThinkingDelta** already flows to the shared stream contract (G3 passes it through); surfacing is a display-only change on #32's side, coordinated with the capability handoff (`docs/reports/provider-capability-handoff-20261017.md`).
- **Composer cloud plan**: cloud accounts (`kind: google_gemini`, `privacyClass: cloud_standard`) dispatch through the SAME stream path (`AnyAdapter::stream_chat`); nothing about the composer's pending/retry/branch logic changes per kind. Consented accounts only — the consent ack is sealed backend-side at configure time and re-checked at dispatch.
- **Still blocked (owner's two stuck `provider-completion` ops + `5d74097`) remain protected** — do not resolve or delete them during testing; pending-delta assertions must count `WHERE status='pending'` (resolved rows persist by design).

## Live-run runbook (DRAFTED ONLY — requires owner approval)

1. Obtain a throwaway Google AI Studio API key; treat as secret (env only, never committed, never screenshotted).
2. `pnpm tauri dev` (local build; no external network beyond Google's official endpoint).
3. Settings → Providers → Google Gemini: paste key, tick the explicit cloud-transfer consent, Connect.
4. Verify: sealed note shown; key not echoed anywhere (reopen the page — no plaintext line); Test connection (metadata model count, no billable generation); Discover (adds only the models Google lists).
5. Single minimal-prompt generation (`Say OK`); max messages ≤ 5; NO system prompts, NO attachments, NO successive queries. Spend budget ≤ trivially small; one run session max.
6. Mid-stream stop; verify partial persists as `Interrupted` and replay reads back.
7. Disconnect: confirm two-step; verify account + models + key disappear (cascade), cache recheck passes.
8. Aftercare: revoke the key in AI Studio; never paste key material into logs/screenshots/evidence; keep all capture synthetic.
9. Any failure → revert to fixtures; report deltas as a follow-up ledger note instead of hot-fixing under spend.

## Evidence hygiene

- No raw app-data paths, key material, or secrets in this file. All `apiKey` strings in fixtures are synthetic (`test-key-123` style) and never persisted outside disposable temp-file SQLite with in-memory content keys.
- Report is revision-tagged to `d2808b0`; re-running gates after new changes invalidates this report rather than amending it.
