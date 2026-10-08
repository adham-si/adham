<aside>
🔌

Companion to P0-08. Research matrix only — it authorizes no install, no scaffold, no code.

</aside>

# P0-08 — Provider wiring matrix and adapter skeleton

## 1. Purpose and boundaries

This document is the research companion to `P0-08 — Provider gateway and normalized stream contract`.
It answers one question: for each planned Adham provider, which settings must be wired to use
its API, and which separate files own each piece.

- **Status:** research only. It does not approve dependencies, installs, scaffolding, or any
  adapter code. P0-01…P0-05 remain the gates before the repository scaffold; P0-08 remains the
  contract gate before any provider implementation.
- **Scope:** all ten planned provider kinds from the product brief — Anthropic, OpenAI,
  Google Gemini, DeepSeek, GLM, xAI Grok, OpenRouter, Ollama Cloud, Ollama Local,
  company/self-hosted.
- **Implementation order is unchanged:** fixtures + fake transport first, then Ollama Local text
  streaming, then one cloud adapter (recommended: OpenAI Responses API, foreground text streaming,
  explicit `store=false`), then the rest only after the common contract passes.
- **Non-goals:** images, audio, video, embeddings, hosted provider tools, remote conversation
  storage, background jobs, and provider-managed agents. Tool proposals stay untrusted and
  unexecuted until P0-09; completion stays unverified until P0-10.
- **Data hygiene:** all keys, tokens, and account values in this file are synthetic placeholders
  (`sk-…`, `$PROVIDER_API_KEY`). No real credentials, user content, or machine paths.
- **File-size note:** 329 lines — over the 300-line target, under the 400-line review bar;
  split per provider before review if it ever grows past 600. Acceptance criteria for the
  common contract, probes, and budget mechanics live in P0-08 / P0-07, not here.

## 2. Shared settings schema

Every provider is wired through the same three descriptors. Adapters receive only resolved,
authorized values — never raw user input, never another context's secrets.

### 2.1 Provider account descriptor

| Field | Meaning |
|---|---|
| `providerKind` | One of the ten kinds in §3 |
| `alias` | User-facing label (may be sensitive — omit from default diagnostics) |
| `credentialRef` | Opaque reference into the OS keyring / encrypted vault, never the secret itself |
| `endpointId` | Approved endpoint this account is bound to |
| `privacyProfile` | Retention class, e.g. `local-only`, `zero-retention-claimed`, `standard-cloud` |
| `grants` | Workspace/project scopes; a global vault entry is not a global authorization |
| `health` / `revision` | Last connection-test result; config revision (endpoint change invalidates grants) |

Multiple accounts per provider are supported. A connection test is an explicitly initiated,
separately authorized operation: it may send account metadata, never a project prompt, and never
a billable generation.

### 2.2 Endpoint descriptor

| Field | Rule |
|---|---|
| `canonicalUrl` + allowed origin/path prefix | Reject userinfo, fragments, unsupported schemes, malformed ports |
| `serviceKind` | `OllamaLocal` \| `OllamaCloud` \| `OfficialCloud` \| `CompanyHosted` \| `CompatibleGateway` |
| Transport | HTTPS required; HTTP only for explicitly approved loopback; redirects disabled, never forwarded with credentials |
| Proxy | Environment proxies ignored by default; explicit reviewed profile only; loopback bypasses proxies |
| DNS / routing | Validate all resolved addresses against the endpoint's network class; cloud endpoints must not resolve to local/private/link-local unless classified as an approved company service |
| Inference locality | Recorded separately from endpoint locality — a loopback URL alone never proves local inference |

“OpenAI-compatible” names a protocol, never an identity or privacy class.

### 2.3 Model selection snapshot

Resolved once at run/step preparation and frozen: `providerKind + accountId + endpointId +
rawModelId + pinnedRevision? + capabilityEvidence`. A mutable upstream alias that cannot be pinned
is recorded as `revision-unverifiable`. Required capability `unknown` blocks dispatch or demands an
approved synthetic probe — never optimistic dispatch. Model install/pull/delete is a separate
reviewed action, never automatic.

### 2.4 Credential and secret rules

- Secrets live in the OS credential facility or encrypted local vault, behind a broker bound to
  `AccountId + EndpointId + origin + scope`. No unrestricted credential-bearing HTTP client.
- Renderer code never holds secrets, builds provider HTTP, or supplies arbitrary URLs.
- Minimize secret lifetime; redact authorization headers, project headers, cookies, response dumps,
  query values, and panic/debug output. Never send workspace/project/session paths or internal IDs
  as provider metadata.

## 3. Per-provider wiring matrix

Conventions: `baseURL` is the adapter's only URL knob and accepts only allowlisted origins;
`apiKey` always resolves via `credentialRef`, shown here as its env-var convention for
documentation only. Wire format notes tell the `stream.rs` owner what to parse — adapters
normalize into Adham stream events, never expose provider events upstream.

### 3.1 OpenAI — recommended first cloud proof

- Auth: `Authorization: Bearer $OPENAI_API_KEY`. Envs: `OPENAI_API_KEY`, `OPENAI_BASE_URL`
  (default `https://api.openai.com/v1`).
- Endpoints: `POST /v1/responses` (recommended; semantic SSE: `response.created`,
  `response.output_text.delta`, `response.completed`, `error`); `POST /v1/chat/completions`
  (legacy chunks `chat.completion.chunk`, terminator `data: [DONE]`, optional
  `stream_options: {"include_usage": true}`).
- Settings: `model`, `input | messages`, `instructions`, `store` (Adham: explicit `false`;
  default `true` stores ≥30 days; ZDR orgs enforce `false`), `stream`, `max_output_tokens`,
  `temperature`, `tools`, `previous_response_id` (stateful only — out of scope for P0).
- Env/compat: remote HTTP rejected before credentials are sent; local loopback HTTP only via
  explicit allow; SDK retry loops disabled — runtime owns retry.
- Pitfalls: billing locks with positive-credit display (`429 account not active` while playground
  works), phantom post-cancellation charges, leaked client-side keys. Design takeaway: budget
  reservation + settlement per attempt, safe-stop with preserved state on 402/429, no silent
  retry-spend.

### 3.2 Anthropic

- Auth: `x-api-key: $ANTHROPIC_API_KEY` + `anthropic-version: 2023-06-01`.
- Endpoint: `POST https://api.anthropic.com/v1/messages`.
- Settings: `model`, `max_tokens` (required; `0` = cache-only probe), `messages[{role, content}]`,
  `system` (top-level, not a role), `temperature 0–1`, `top_k`, `top_p`, `stream`, `tools`,
  `stop_sequences`. Prefer temperature *or* `top_p`, not both.
- Streaming: SSE `message_start`, `content_block_start/delta/stop`, `message_delta/stop`;
  accumulate via SDK-style `finalMessage()` helper. Raw SSE needs explicit event handling.
- Timeouts: long non-streaming requests risk idle drops past ~10 min; prefer streaming or Batches
  API; TCP keep-alive on direct integrations.
- Pitfalls: mid-stream `ECONNRESET` clusters on large context (≥6MB carries most resets), retry
  ladders amplifying blips into minutes-long outages, limit-boundary resets instead of clean 429s.
  Design takeaway: runtime-owned backoff with jitter, parse `anthropic-ratelimit-*` + `retry-after`,
  separate transport-end from valid completion.

### 3.3 Google Gemini

- Auth: native `x-goog-api-key: $GEMINI_API_KEY`; OpenAI-compat `apiKey: $GEMINI_API_KEY` with
  `baseURL https://generativelanguage.googleapis.com/v1beta/openai/`. Since 2026-05-28 new keys
  are authorization keys by default; unrestricted standard keys are rejected; long-dormant
  unrestricted keys are blocked.
- Settings: `model` (e.g. `gemini-3.8-flash`), `thinking_level` (`low`/`high` via OpenAI-compat maps
  to token budgets), `thinking_config`, `seed`, `tools`. Official SDKs auto-retry 429/5xx with
  backoff — disable inside the adapter.
- Streaming: SSE text deltas; thought-summary deltas are a distinct event type when enabled.
- Pitfalls: `leaked-key` blocks requiring rotation, quota/billing confusion from shared project keys,
  repetition needing explicit conciseness controls. Design takeaway: restricted keys per account,
  surfaced key-health state, no key reuse across privacy classes.

### 3.4 DeepSeek

- Auth: `Authorization: Bearer $DEEPSEEK_API_KEY`. OpenAI-compat `base_url
  https://api.deepseek.com`; Anthropic-compat `https://api.deepseek.com/anthropic`.
- Models (2026): `deepseek-flash`, `deepseek-v4-pro` (legacy `deepseek-chat`/`deepseek-reasoner`
  deprecated 2026-07-24; treat old names as aliases only).
- Settings: `model`, `messages`, `thinking: {"type": "enabled"}`, `reasoning_effort`, `stream`,
  standard OpenAI chat fields; also `POST /responses` and image-only `POST /files`.
- Pitfalls: model-name churn breaking pinned configs; third-party Responses-path 400s on Pro.
  Design takeaway: pin via `ModelSelectionSnapshot`, record `revision-unverifiable` when the API
  cannot pin, re-validate capability cache on digest change.

### 3.5 GLM (Zhipu)

- Auth: `Authorization: Bearer $ZHIPU_API_KEY`. China base `https://open.bigmodel.cn/api/paas/v4`;
  international `https://api.z.ai/api/paas/v4`. Coding-plan endpoint
  `https://open.bigmodel.cn/api/coding/paas/v4` is for coding-plan integrations only.
- Endpoint: `POST {base}/chat/completions` (OpenAI-chat-like shape: `id`, `model`, `choices`,
  `choices[0].message`, `usage`); async variant plus `GET {base}/async-result/{id}`.
- Settings: `model` (`glm-4.7`, `glm-5.3`, … — never OpenAI names), `messages`, `temperature`,
  `stream`, provider tools; structured-output and multimodal flags are model-specific.
- Community SDK: `zhipu-ai-provider` (`ZHIPU_API_KEY`, `createZhipu({baseURL, apiKey, headers})`).
- Pitfalls: overseas-SMS registration friction, assuming full OpenAI parity for tools/structured
  output, using the coding endpoint for general chat. Design takeaway: separate endpoint records
  per plan, per-model capability evidence, never assume modality support.

### 3.6 xAI Grok

- Auth: `Authorization: Bearer $XAI_API_KEY`. Base `https://api.x.ai/v1`; US-regional
  `https://us.api.x.ai/v1` (+10% price, US inference). Console-issued key; `.env` convention
  `XAI_API_KEY=…`.
- Endpoints: `POST /v1/responses` (new features land here first) and legacy
  `POST /v1/chat/completions`. AI-SDK: `xai.responses('grok-4.7')`.
- Settings: `model` (`grok-4.7`), `input | messages`, `stream`, `temperature 0–2`,
  `max_output_tokens` (covers reasoning tokens), `tools` (`web_search`, `x_search`,
  `code_interpreter`), `previous_response_id`, `prompt_cache_key`. Reasoning models need
  `timeout ≈ 3600s` — defaults close connections prematurely.
- Streaming: SSE deltas; chat chunks `chat.completion.chunk` with `delta.content` or
  `delta.reasoning_content`; Responses stream ends `data: [DONE]`.
- Pitfalls: silent ignoring of unsupported fields (e.g. logprobs on newer models). Design
  takeaway: treat unknown-field acceptance as `unknown` capability, verify against fixtures.

### 3.7 OpenRouter — multi-model gateway

- Auth: `Authorization: Bearer $OPENROUTER_API_KEY` (credit-limited keys supported; OAuth
  available). Base `https://openrouter.ai/api/v1`; chat `POST /api/v1/chat/completions`;
  Responses beta `POST /api/v1/responses` (stateless only); Anthropic-compat messages endpoint.
- Settings: `model` as `author/slug` (e.g. `openai/gpt-5.2` — never a bare provider name),
  standard chat fields plus optional attribution `HTTP-Referer`, `X-Title`, and routing/fallback
  options. Own SDK `@openrouter/sdk` exists, but the OpenAI SDK pointed at the base URL is the
  documented path.
- Errors are structured (`401` auth, `402` insufficient credits, `429` rate limit, `5xx`
  provider/upstream). Gateways return provider-normalized `choices` arrays.
- Pitfalls: Feb 2026 cache-dependency outages (80–90% failure at peak), provider rotation killing
  prompt caching (reported 10–32× cost on DeepSeek Flash), markup vs direct pricing. Design
  takeaway: classify as `CompatibleGateway` (never a privacy class), pin provider when caching
  matters, budget against worst-case reroute, fallback chains are router policy — not adapter logic.

### 3.8 Ollama Local — implement first

- Auth: none (send dummy `ollama` only if the SDK demands a value). Host via `OLLAMA_HOST`
  (default `http://localhost:11434`); origins via `OLLAMA_ORIGINS`.
- Native: `POST /api/chat` NDJSON (`application/x-ndjson`), one object per line
  (`{"response":"…","done":false}` … final `{"done":true,"done_reason":"stop"}` + usage +
  nanosecond durations). Usage arrives on the final chunk — missing usage ≠ zero usage.
  `stream:false` returns single JSON. Discovery: `GET /api/tags`, `/api/ps`, `/api/version`.
- OpenAI-compat: `POST /v1/chat/completions` (+ `/v1/responses`, stateless only; supported:
  streaming, JSON mode, vision, tools, reasoning controls; not: logprobs, `tool_choice`,
  `logit_bias`, `user`, `n`).
- Settings: `model` (local tag), `messages`, `tools` (needs function-calling model + Ollama ≥0.4),
  `format` (`json` or schema), `options` (runtime generation controls), `stream`, `think`.
- Pitfalls: snap-packaged `OLLAMA_HOST=0.0.0.0` still binding loopback, absent `include_usage`
  on the compat path, oversized `num_ctx` the machine cannot honor. Design takeaway: verify
  effective journal/health at startup, confirm locality evidence separately from URL shape.

### 3.9 Ollama Cloud

- Auth: `Authorization: Bearer $OLLAMA_API_KEY`. OpenAI-compat `base_url https://ollama.com/v1`;
  native `https://ollama.com/api/chat`; model list `GET https://ollama.com/api/tags` (cloud names
  e.g. `gemma4:31b`; CLI alias `gemma4:cloud`; no pull needed).
- Local-only mode: `~/.ollama/server.json {"disable_ollama_cloud": true}` or `OLLAMA_NO_CLOUD=1`
  + restart; logs confirm `cloud disabled: true`. Disabling forfeits cloud models + web search.
- Limits: no stateful Responses (`previous_response_id`/conversations), no built-in web search via
  `/v1/responses`, no custom/freeform tool-call replay; retirements announced by email + website
  (e.g. `minimax-m2.5`, `kimi-k2.5` retired 2026-07-31).
- Pitfalls: timeout storms under load with “operational” status pages, third-party hosting opacity
  debates (which infrastructure serves which model), model retirements breaking pinned names.
  Design takeaway: distinct `OllamaCloud` service kind, cache discovery per account+endpoint+rev,
  recheck capabilities on digest change, surface retirement notices in settings.

### 3.10 Company-hosted and self-hosted open-source models

- Shape: almost always an OpenAI-compatible protocol endpoint (`/v1/chat/completions`, sometimes
  `/v1/responses`, `/v1/models`). Wire each deployment as its own `Endpoint` record — never share
  one record across deployments.
- Settings: `baseURL` (deployment-specific), deployment credential or none for loopback, `model`
  (deployment catalog name), standard chat fields; capability evidence starts at `unknown` until a
  synthetic probe passes.
- Rules: TLS validated (no bypass to make requests succeed); metadata-service destinations
  rejected; cloud-class endpoints must not resolve to local/private/link-local; no ambient
  fallback to another host, port, account, or gateway. A company server is not automatically
  local-only or confidential — its privacy class needs explicit evidence.

## 4. Adapter and IPC skeleton

Each provider directory composes small modules behind the shared port. No file owns two
responsibilities; nothing here is code — names only, for the P0-08 implementation plan.

```
crates/adham-provider/src/
├── lib.rs            # Public API only (re-exports port, registry, error, stream types)
├── port.rs           # ProviderPort trait: encode(request) -> bounded transport -> normalized events
├── capability.rs     # Tri-state capability record + evidence (supported/unsupported/unknown)
├── request.rs        # ProviderRequestV1 (immutable, scoped, §2.3)
├── response.rs       # Normalized result envelope (accepted output separate from partials)
├── stream.rs         # Normalized stream events; transport-end vs valid-completion split
├── error.rs          # Safe error taxonomy (transport/timeout/rate-limit/auth/capability/budget)
├── registry.rs       # Account/endpoint/model-descriptor cache keyed by account+endpoint+rev
└── adapters/
    ├── ollama/       # Implement FIRST (local text streaming)
    │   ├── mod.rs client.rs models.rs request.rs response.rs stream.rs error.rs tests.rs
    ├── openai/       # Implement SECOND (first cloud proof, Responses + store=false)
    │   └── mod.rs client.rs models.rs request.rs response.rs stream.rs error.rs tests.rs
    ├── anthropic/ gemini/ deepseek/ glm/ grok/ openrouter/ ollama_cloud/ company/
    │   └── (same seven files each — added only after the common contract passes)
```

Module duties: `client` (URL join via `url`, never string concat; headers; TLS; timeout;
no retry), `models` (descriptor + capability evidence), `request`/`response` (wire conversion),
`stream` (bounded SSE/NDJSON parser with size caps + redaction), `error` (provider body is
untrusted input), `tests` (fixture replay incl. truncated-stream, missing-usage, 429/402/529,
ECONNRESET cases).

Gateway pipeline (owner in parentheses): runtime step → immutable snapshot → capability +
revision check (provider) → grant + privacy/destination check (policy/credentials) → budget
reservation (runtime) → credential broker → adapter encode → bounded transport → normalized
stream → runtime validates + commits protected output/usage → projection/verification path.
Retry, cancellation, pause/resume, and checkpoints stay in the P0-07 runtime.

Frontend settings surface (no secrets cross IPC to the renderer): account list (alias +
provider + health), endpoint picker (allowlisted origins only), model picker (cached descriptors),
privacy-class label per selection, budget caps, retention flag. Typed commands:

- `get_provider_accounts` / `get_models(accountId)` — read-only, cached descriptors.
- `save_provider_account` — writes endpoint config + keyring ref; never returns secrets.
- `test_provider_connection` — explicit button; metadata only, no prompt, no billable call.
- `dispatch` carries `OperationId + AttemptId + epoch + snapshot + grant + reservation`; adapters
  receive data only. IPC DTOs generated via `ts-rs` from transport types (P0 decision), committed,
  CI-checked for drift, Zod-validated at the boundary.

## 5. Community risk log, sources, and open decisions

### 5.1 Risk log (feedback → Adham rule)

| # | Signal | Adham rule |
|---|---|---|
| R1 | OpenAI billing locks / phantom charges; support slow | Per-attempt budget reservation + settlement; safe-stop with state preserved; surfaced usage vs billed-usage gap |
| R2 | Anthropic mid-stream ECONNRESET / rate storms | Runtime-owned retry with jitter; first retries near-immediate; header-aware throttling; never mid-stream silent resume |
| R3 | Gemini key blocks / unrestricted-key rejection | Restricted auth keys per account; key-health in settings; rotation flow |
| R4 | OpenRouter outages + cache-killing rotation | Gateway ≠ privacy class; provider pinning option; worst-case budgeting; status-aware fallback policy |
| R5 | Ollama Cloud load timeouts + hosting-opacity debate | Separate `OllamaCloud` kind; locality evidence ≠ URL shape; retirement notices in UI |
| R6 | DeepSeek/GLM model renames + endpoint confusion | Snapshot + `revision-unverifiable` marking; separate coding-plan endpoint record |
| R7 | xAI reasoning timeouts on defaults | Per-provider timeout in endpoint record; 3600s-class for reasoning models |
| R8 | V2EX `go/openai` + `go/claude` nodes: recurring ban/封号 and quota threads | Region + account-health evidence fields; no shared keys across privacy classes |

### 5.2 Sources

- Context7: `/websites/developers_openai_api_reference` (auth, Responses SSE, `store`, loopback
  policy); `/websites/platform_claude_en_api` (Messages API, streaming helpers, long-request
  guidance); `/vercel/ai` (`createXxx` per-provider settings, `createProviderRegistry` pattern).
- Live channels (`agent-reach doctor` 4/16: V2EX, RSS, Jina Reader, Bilibili-search verified via
  `curl.exe` against `v2ex.com/api/topics/hot.json` and `r.jina.ai/https://docs.ollama.com/api/chat`;
  GitHub/YouTube/Exa + 9 login channels unavailable — no data hallucinated from them).
- Web: OpenAI streaming + migration guides; Anthropic Messages reference; Gemini OpenAI-compat +
  API-key docs; DeepSeek first-call + samples; Zhipu `bigmodel.cn` API + AI-SDK community provider;
  xAI quickstart/streaming/tools; OpenRouter auth + status blog; Ollama chat/streaming/cloud/FAQ +
  privacy; `community.openai.com` billing threads; `github.com/anthropics/claude-code` ECONNRESET
  issues; `github.com/ollama/ollama` cloud-reliability + retention issues; `r/openrouter`
  caching-cost threads (via search excerpts).

### 5.3 Open decisions (human-gated, unchanged)

1. License (Apache-2.0 recommended; no placeholder `LICENSE`).
2. Node 24 LTS baseline.
3. `ts-rs` for P0 IPC DTOs.
4. Manual Vite + `pnpm tauri init` scaffold route.
5. Domain-command boundary (no generic `append_session_event`).
6. Dependency-set approval before any install.

Phase authorization stands: this matrix does not authorize Phase A, publishing, providers, tools,
plugins, MCP, network permissions, credential creation, or `latest` without pinned versions.
