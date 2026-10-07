<aside>
🔌

Providers supply model output, not authority. Adham’s trusted gateway binds each request to an immutable execution context, approved account and endpoint, explicit privacy policy, and reserved budget. A loopback URL does not by itself prove local inference; a successful provider response does not prove task completion.

</aside>

## Purpose and implementation boundary

Define the provider-neutral Rust gateway, capability registry, request/response contracts, normalized stream, errors, cancellation and reconciliation, usage/cost accounting, privacy-aware selection, and adapter acceptance gates.

Implementation order:

1. Deterministic protocol fixtures and fake transport.
2. Ollama Local text streaming with an already installed local model.
3. One separately approved cloud adapter to prove account, privacy, credential, and accounting boundaries.
4. Additional providers only after the common contract passes.

**Recommended first cloud proof:** OpenAI Responses API, foreground text streaming with explicit store=false. This is a proposed implementation choice, not prior approval to spend, transfer content, install dependencies, or use a particular model. A different first cloud provider requires a reviewed adapter plan, not a redesign of the runtime.

Tools may be normalized as proposals but cannot execute before P0-09. Production completion remains subject to P0-10 verification. Images, audio, video, embeddings, hosted provider tools, remote conversation storage, background jobs, and provider-managed agents are outside this first implementation.

### Governing Adham specifications

- P0-07 — Agent runtime state machine.
- P0-06 — Repository scaffold execution and evidence checklist.
- P0-02 — Canonical event taxonomy & schema.
- P0-03 — SQLite event store, content & projections.
- P0-04 — Typed IPC, capabilities & frontend sync.
- P0-05 — Project-isolation threat model.
- Frontend UX — Settings architecture.

## 1. Verified API baseline and design implications

Ollama’s /api/chat supports streamed NDJSON, message content, model-dependent thinking/tool output, format controls, and a final done marker. Usage metrics are reported on the final stream chunk; durations use nanoseconds. Adham must distinguish transport end from valid completion and missing usage from zero usage.[[1]](https://docs.ollama.com/api/chat)[[2]](https://docs.ollama.com/api/usage)

Ollama can access cloud models through a local server. Its documented local-only controls include disable_ollama_cloud and OLLAMA_NO_CLOUD=1, requiring a server restart. Therefore endpoint locality and inference locality require separate evidence.[[3]](https://docs.ollama.com/api/introduction)[[4]](https://docs.ollama.com/faq)

OpenAI Responses HTTP streaming uses SSE lifecycle and text-delta events. Adham translates these into its own stream contract rather than exposing provider events to the runtime or renderer.[[5]](https://platform.openai.com/docs/guides/streaming-responses)

OpenAI documents application-state and abuse-monitoring retention separately. Setting store=false is not a claim of universal zero retention; special retention controls require account-specific eligibility/configuration. Adham must describe the actual provider/account policy honestly.[[6]](https://developers.openai.com/api/docs/guides/your-data)

API behavior evolves. At implementation, record tested server/API versions, supported model revisions, fixture provenance, and the current provider policy review. Do not freeze assumptions from mutable documentation without protocol tests.

## 2. Non-negotiable boundaries

1. Runtime requests are immutable and scoped; providers receive only explicitly selected context.
2. Renderer code never holds provider credentials, constructs provider HTTP requests, or supplies arbitrary authenticated URLs.
3. Provider adapters implement wire protocols, not routing policy, retries, budget decisions, context compaction, or completion verification.
4. No adapter silently changes model, endpoint, account, privacy class, retention setting, or protocol.
5. Automatic retry is owned by the P0-07 runtime. SDK/HTTP retry loops must be disabled or avoided.
6. Each dispatch belongs to one OperationId, AttemptId, driver epoch, request snapshot, grant, and budget reservation.
7. Capability metadata is evidence-backed and tri-state: supported, unsupported, unknown.
8. Tool requests remain untrusted proposals. Complete syntax is necessary but never sufficient authorization.
9. Partial/failed streams stay separate from accepted assistant responses.
10. Uncertain dispatch, completion, token usage, or charges remain explicit; no false exactly-once or free-retry claim.
11. A provider response cannot append events directly or determine task completion.
12. Provider errors, headers, and response bodies are untrusted sensitive input and must be bounded/redacted.

## 3. Gateway pipeline and ownership

```
runtime model step
→ immutable request/context snapshot
→ capability + model revision validation
→ project/account/endpoint grant
→ privacy + retention + destination policy
→ token/output estimate and budget reservation
→ trusted credential broker
→ adapter encodes one request
→ bounded transport/parser
→ normalized stream/result
→ runtime validates and commits protected output/usage
→ projection/verification path
```

- **adham-provider:** shared provider contract, registry/model descriptors, protocol adapters, normalization, safe errors.
- **adham-router:** approved deterministic selection/fallback plan; introduce only when actual routing code exists.
- **adham-runtime:** attempts, retry scheduling, cancellation intent, checkpoints, usage reservations/settlement orchestration.
- **policy/credential ports:** account/destination grants and short-lived secret access; implementations stay in trusted platform/security boundaries.
- **context port:** authorized context snapshot and token-pressure handling; no adapter reaches into project storage or memory.

Discovery/health are separately authorized operations. A connection test may send account metadata to a provider and must be explicitly initiated; it sends no project prompt and must not silently run a billable generation.

## 4. Account and endpoint identity

### Provider account descriptor

ProviderAccountId, provider kind, user-facing alias, credential reference, approved EndpointId, account/project identifiers where necessary, grants, privacy/retention profile, region evidence, health status, and configuration revision.

Multiple accounts for one provider are supported. Credentials can be application-scoped but require workspace/project grants; a global vault entry is not a global authorization.

Aliases/account identifiers may be sensitive: protect persisted values where appropriate, omit them from default diagnostics, and never put them in model context.

### Endpoint descriptor

Canonical URL, allowed origin and path prefix, transport policy, service kind, credential binding, proxy policy, TLS/trust policy, inference-location classification, and revision.

Service kinds distinguish:

- Ollama Local;
- Ollama Cloud;
- official cloud API;
- company/self-hosted;
- compatible third-party gateway.

“OpenAI-compatible” describes a protocol, not an OpenAI identity or a trusted privacy class. A company-hosted server is not automatically local-only or confidential.

Endpoint changes invalidate credential grants/capability caches and require review. No ambient fallback to another host, localhost port, account, or gateway.

## 5. Network and credential enforcement

- Only trusted settings/application commands create reviewed endpoint configurations.
- Reject userinfo, fragments, unsupported schemes, malformed ports, and unexpected path normalization.
- Permit HTTP only for explicitly approved local loopback services; remote services require validated TLS.
- Disable redirects by default. Never forward credentials to a redirected origin.
- Ignore environment proxy settings by default; proxy use requires an explicit reviewed profile. Loopback traffic must bypass unintended proxies.
- Bind hostname/address policy to the actual connection; validate all resolved addresses under the endpoint’s allowed network class and prevent rebinding/policy bypass.
- Cloud endpoints must not resolve into local/private/link-local destinations unless explicitly classified as an approved company service.
- Reject metadata-service destinations and unsafe custom trust/TLS bypasses. Never disable certificate verification to make a request succeed.
- Credential broker binds secret use to ProviderAccountId + EndpointId + origin + approved scope. Do not expose an unrestricted credential-bearing HTTP client.
- Minimize secret lifetime; redact authorization headers, provider project headers, cookies, response dumps, URL query values, and panic/debug output.
- Never send Adham workspace/project/session paths, internal IDs, names, or private diagnostic context as provider metadata by default.
- Send only minimum reviewed correlation/idempotency headers supported by that specific API. Provider request IDs remain distinct from Adham IDs and may require protected storage.

A same-user process may impersonate an unauthenticated loopback server. Report this residual risk; do not describe loopback as authenticated. HTTPS/custom certificates or service identity attestation may be required for higher-assurance profiles.

## 6. Model registry and capability evidence

### Model descriptor

Provider kind/account binding, raw provider model ID, human label, model revision/digest when available, adapter/API compatibility revision, inference privacy class, modalities, limits, pricing reference, and capability evidence.

Capabilities include text input/output, streaming, structured output, tool proposals, thinking controls, cancellation level, retrieval/reconciliation, idempotent generation, usage reporting, and token-estimator availability.

For each capability record supported/unsupported/unknown, evidence source, observed server/model revision, last review, and any constraints. Model-list entries alone do not prove context size, tool correctness, pricing, or output format support.

### Model selection rules

- Resolve user-friendly aliases to an immutable selection snapshot at run/step preparation.
- An upstream mutable alias may change. If a provider cannot pin the model, record revision-unverifiable and disclose the limitation.
- Local model digest changes invalidate cached validation; recheck capabilities before dispatch.
- Required capability unknown → reject/block or require an approved validation probe, not optimistic dispatch.
- Probe only with synthetic content, explicit authority, and resource/billing limits.
- Do not download/pull/create/delete models automatically. Model installation is a separate reviewed action.
- Cache discovery by account, endpoint, adapter/server revision, and model identity; never by raw model name alone.

Context capacity includes input plus output/reasoning reservations under the provider’s actual semantics. A larger configured local num_ctx is not proof that the machine can support it.

## 7. Normalized request contract

ProviderRequestV1 contains:

- trusted ExecutionIdentity handle;
- OperationId, AttemptId, driver epoch, and RequestSnapshotId;
- approved ModelSelectionSnapshot and account/endpoint grant references;
- ContextSnapshotId and authorized message content references;
- output-token cap, optional reviewed sampling controls, and response format;
- tool proposal definitions only when a later approved tool contract enables them;
- deadline/cancellation token and approved privacy/retention profile;
- budget reservation and pricing-version references.

Adapters receive only the resolved authorized request data and a constrained credential/transport facility. Internal authorization metadata is not serialized into the provider prompt.

### Message/content semantics