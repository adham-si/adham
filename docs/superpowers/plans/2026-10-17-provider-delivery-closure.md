# Provider Delivery Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Delivery A — honest provider/model settings surface (remove Preview banners, accurate copy, distinct backend-derived states, endpoint invalidation, registry-faithful model rows, accurate local-only wording) plus the #32 handoff note for the owner's abandoned provider operations.

**Architecture:** No backend changes. All work is in the settings surfaces (`apps/desktop/src/pages/settings/{providers,models}`), the compose boundary note (i18n only), and locale resources (en, ar, ru, zh-CN). States are client-side, timestamped, and endpoint-guarded; configured data and model inventory stay backend-derived (`list_provider_accounts`, `list_provider_models`).

**Tech Stack:** React 19, @tanstack/react-query, react-i18next, vitest + testing-library.

**Spec:** User work order 2026-10-17 "Close the existing Ollama provider delivery only" (six items, in-chat). Companion context: `docs/reports/provider-delivery-a-20261017.md`.

## Global Constraints

- **No backend changes** — Rust untouched; every state shown must be derivable from `list_provider_accounts`, `test_provider_connection` (client-side timestamp), `discover_ollama_models`, `list_provider_models`.
- **Preserve `5d74097`** (thinking-frame fix): never edit `crates/adham-provider/src/adapters/ollama_http.rs` or its tests.
- **No production model-name constants**: UI code must not hardcode model ids/names beyond test fixtures; capabilities render only as recorded; `unknown` stays `unknown` (no inference).
- **No deletion of data**: owner's two pending `provider-completion` operations are neither cleared, dismissed, nor replayed; they are documented for handoff to #32.
- Scope = the working Ollama surfaces only (Providers, Models pages, compose boundary note). Static catalog previews on other settings pages keep their Preview notes. No dead-code cleanup.
- Locales touched (en, ar, ru, zh-CN) must all be updated for every changed/added key.
- Targets <300 lines per file; `ProviderCapabilitiesDto.capabilities` values are `supported` / `unknown` / etc. — render only clearly known ones.
- Gates from repo root: `pnpm check`, `cargo test --workspace --locked`, `cargo clippy --workspace --all-targets --locked`, `cargo fmt`.

## Review Focus

1. **Stale attribution** — a previously-tested/discovered result shown under an edited (different) endpoint: the UI must never present endpoint-A results under endpoint-B. Pinned by `epd` regression test (Task 2).
2. **Cached status as fresh check** — after app reopen, no reachability line may appear without a check actually being run that session; inventory shown is labeled "recorded/saved", not "discoverable/live". Pinned in Task 2.
3. **Capability inference** — a model row must not render a capability the registry did not record; only recorded `supported` capabilities render. Pinned in Task 3.
4. **Label/ID duplication** — rows where `humanLabel === modelId` must not print the id twice. Pinned in Task 3.
5. **Over-promising copy** — no string in EN or translations may guarantee "zero/never leaves", cloud connectivity, fallback chains, or defaults that no code implements. Pinned in Tasks 1 and 4 by existing literal tests + new wording assertions.

## Task 1: Remove blanket Preview banners + rewrite shipped-scope copy

**Files:**
- Modify: `apps/desktop/src/pages/settings/providers/providers-page.tsx` (drop `<PreviewNote />`, page desc string)
- Modify: `apps/desktop/src/pages/settings/models/models-page.tsx` (drop `<PreviewNote />`, page desc + local-first note comment)
- Modify: `apps/desktop/src/shared/i18n/locales/{en,ar,ru,zh-CN}/settings.json` — keys `providers.desc`, `models.desc`, `models.localFirstNote`
- Test: `apps/desktop/src/pages/settings/models/models-page.test.tsx` (literal strings updated en+ar)

**Interfaces:** Consumes nothing new. Produces locale keys later tasks reuse.

- [x] Step 1: Update the existing models-page tests to the NEW en/ar literals (they pin literal strings; this is the failing-test step)
- [x] Step 2: Edit the two pages + locale files (all four languages, same keys)
- [x] Step 3: `pnpm vitest run` the two page suites → PASS; assert `screen.queryByText('settings.preview.title' text)` absent on both pages: add one assertion per page that no Preview note renders while Ollama controls render
- [x] Step 4: Commit (`git add <explicit paths>`).

New copy decisions (exact):
- `providers.desc` EN: "Register a local Ollama endpoint and use its installed models in conversations."
- `models.desc` EN: "Models discovered from your registered Ollama endpoint. Nothing is assigned as default; no fallback chain."
- `models.localFirstNote` EN: "Dispatch is restricted to provider accounts classified local-only, configured to addresses you choose yourself. Cloud providers are not implemented in this delivery."
- Translation of the same meaning in ar/ru/zh-CN (no "never leaves" guarantees for `localBoundaryNote` — see Task 4).

## Task 2: Provider card states + endpoint invalidation (regression test)

**Files:**
- Modify: `apps/desktop/src/pages/settings/providers/components/ollama-connect.tsx` (rebuild state display)
- Test: `apps/desktop/src/pages/settings/providers/providers-page.test.tsx` (update 2 literal assertions; add new tests)

**Interfaces:**
- Consumes: `adhamClient.listProviderAccounts()`, `listProviderModels(accountId)`, `testProviderConnection(accountIdOrEmpty, undefined, {endpointUrl})`, `updateProviderAccount`, `discoverOllamaModels(accountId)`, `queryKeys.providerAccounts|providerModels`.
- Produces: displayed lines (exact keys to add in locales for all 4 languages):
  - `configuredLine`: "Configured — {{alias}} at {{url}}"
  - `notConfiguredLine`: "No endpoint configured yet. Test one to register it."
  - `inventoryLine`: "{{count}} models recorded from {{url}}."
  - `inventoryNone`: "No models recorded from {{url}} yet."
  - `lastCheckReachable`: "Last check {{time}}: reachable ({{count}} endpoints advertised)."
  - `lastCheckUnreachable`: "Last check {{time}}: no response from {{url}}."
  - `checkPending`: "Not checked for this endpoint in this session."
  - `unsavedAttribution`: "Models above were recorded for {{url}}; re-test and discover before the edited endpoint replaces them."

- [x] Step 1: Write failing tests:
  1. `shows configured endpoint and recorded inventory on reopen without any check` — saved account seeded, inventory query stubbed with 2 models; assert configuredLine + inventoryLine render, and NO reachability phrase renders.
  2. `editing the endpoint invalidates prior test and discovery results (stale attribution regression)` — check state: assert `lastCheckReachable`/`unreachable` line NEVER renders `check.endpoint !== input value`; with saved 11434 + edit to 11435: the "models recorded from 11434" attribution line stays labeled with 11434, and Discover stays disabled until re-test mints/updates the account; after Test+Discover the recorded attribution shows 11435 via `update_provider_account` invoking `endpointUrl: 'http://127.0.0.1:11435'` and discover invoked with the minted accountId.
  3. `failed check is a distinct error never stored as post-edit status` — after successful test on A, edit to B: edited value no longer inherits A's reachable state (UI shows checkPending for B).
- [x] Step 2: Run → FAIL (old copy/states).
- [x] Step 3: Implement `OllamaConnect` rebuild:
  - `configured` = saved account (backend).
  - Check result state: `{endpoint: string; at: number; reachable: boolean; tags: number | null}` in `useState`; rendered only when `check.endpoint === value.trim()`; edit → derived guard hides it (no stale status). Discover result flash: same endpooint guard; inventory from `listProviderModels` query keyed by saved accountId, attributed to `saved.endpointUrl` explicitly.
  - Discover disabled while `dirty` (endpoint reliability: discovery only against the account as saved).
  - Errors: distinct `role=alert` line for unreachable vs thrown.
- [x] Step 4: Run suites → PASS. Update the 2 prior literal assertions to the new phrasing.
- [x] Step 5: Commit.

## Task 3: Discovered-model rows

**Files:**
- Modify: `apps/desktop/src/pages/settings/models/components/ollama-models.tsx`
- Test: `apps/desktop/src/pages/settings/models/models-page.test.tsx`

**Interfaces:** Consumes `ProviderModelDto {modelId, digest, humanLabel, capabilities}` + account alias from `listProviderAccounts`. Produces row rendering rules:
- Name: `humanLabel` only; raw `modelId` line **only if differs** (`m.modelId !== m.humanLabel`).
- Association line: account alias from query (e.g. "Local Ollama").
- Verified metadata: `digest.slice(0, 12)` prefixed "sha256" when present.
- Capabilities: render chips ONLY for recorded `"supported"` values mapped from capabilities keys (streaming/thinking/toolProposals/structuredOutput); `unknown`/absent → no chip, no inference.

- [x] Step 1: Failing tests:
  1. `shows raw id only when different from the display name` — stub 2 models: one with `humanLabel !== modelId` (id line present), one with equal (absent).
  2. `attributes rows to the account and shows only verified metadata` — alias "Local Ollama" rendered per row/section; digest prefix shown; `thinking: 'unknown'` → no thinking chip even if the id contains a reasoning-family name (fixture id must imply nothing — e.g. `deepseek-r1:*` with thinking `unknown` → NO chip).
- [x] Step 2: Run → FAIL.
- [x] Step 3: Implement row update.
- [x] Step 4: Run suites → PASS.
- [x] Step 5: Commit.

## Task 4: Compose boundary wording (accurate local-only language)

**Files:**
- Modify: `apps/desktop/src/shared/i18n/locales/{en,ar,ru,zh-CN}/compose.json` — `compose.localBoundaryNote`

**Interfaces:** Consumes nothing. Produces: title text for the LOCAL badge tooltip.

- [x] Step 1: Rewrite value in 4 locales: EN = "Dispatch restricted to local-only provider endpoints you configured (typically this machine)."
- [x] Step 2: Conversation-panel/compose tests referencing the old literal (`Zero data leaves this machine`): grep; update if pinned (expected: none pin this tooltip; add none).
- [x] Step 3: Commit.

## Task 5: Evidence, #32 handoff, ledger, gates

**Files:**
- Modify: `docs/reports/provider-delivery-a-20261017.md` (add closure section: items done, tests, gates, #32 handoff of the two pending provider-completion operations — scope ids only, no secrets, no content)
- Modify: `.superpowers/sdd/provider-delivery-a/progress.md` (gitignored — never stage)

- [x] Step 1: Full gates from repo root (`pnpm check`, `cargo test --workspace --locked`, clippy, fmt) — commit any formatting fallout first.
- [x] Step 2: Commit docs; update plan checkboxes; ledger.
- [x] Step 3: Report head/range/files/deps/tests/limitations.

## Self-review notes

- Spec coverage: items 1→2 (Task 1), 3→4 (Task 2), 5 (Task 3), 6 (Task 4), 7 (Task 5 + untouched files) ✓.
- No backend work → no OpenAI/other-provider work anywhere ✓.
- The compose widget `DEFAULT_MODELS` dormant catalog list is NOT touched (cleanup ban; both real callers pass registry models explicitly). Compose picker logic untouched — i18n only.
