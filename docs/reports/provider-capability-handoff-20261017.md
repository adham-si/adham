# Capability handoff — installed model & server (#32 coordination)

Date: 2026-10-17 · Branch: feat/settings-completion · Evidence: live reads against the
running local daemon (`http://127.0.0.1:11434`), sanitized (no prompt/content, no
license or modelfile dumps). Structural-only chat probes; generated content discarded.

## 1. Live evidence

| Item | Value (from the wire) |
| --- | --- |
| Ollama version (`/api/version`) | `0.40.5` |
| Model ID | `qwen3.5:0.8b` |
| Digest | `d9c89605f39abfd9e8cb4fd3c099c203d7d17e82d7765b4266a0612402d88f1c` — matches the Adham registry row recorded 2026-10-17 14:39:55Z (byte-identical provenance) |
| Blob size / modified (`/api/tags`) | 1,244,131,636 B / 2026-10-17T13:58:57Z |
| `/api/show` `capabilities` | `["completion", "vision", "thinking", "tools"]` |
| `/api/show` `thinking` record | `{"values": [false, true], "default": true}` |
| `/api/show` `requires` | `0.19.0` |
| Details | family `qwen3_5`, parameter_size `852.88M`, quantization_level `mxfp8`, runner `mlx`, format `safetensors` |
| Parameter count (`model_info.general.parameter_count`) | present (value recorded, not load-bearing here) |
| Context | **Model-declared** `qwen3_5.context_length` = **262144** (256k). **Configured**: the saved modelfile `parameters` string contains no `num_ctx` — nothing is configured. **Effective**: unknown — Adham's adapter never sends `num_ctx`, and no probed daemon endpoint exposes the daemon default. No value is fabricated. |
| Template | effectively empty (13 chars) for this manifest; the thinking control surfaces via the top-level `thinking` record, not the template |

### Thinking controls — live probe (bounded)

Identical minimal request (`messages`-chat, `stream:true`, `options.num_predict = 4`);
only the response **shape** was recorded, never the generated text:

| Request | Status | `message.thinking` frames | content frames |
| --- | --- | --- | --- |
| `think: true` | 200 | present | absent (within window) |
| `think: false` | 200 | absent | present |
| omitted | 200 | present | absent (matches declared default `true`) |

⇒ This daemon+model pair supports the `think` request control for both `true` and
`false`, and defaults to thinking **enabled**. The adapter could pass this control
and route the `thinking` field into its tri-state handling once #32 defines the
consumer contract.

## 2. Capability matrix (per-capability ownership)

| Capability | Provider/model (wire) | Adham adapter | Adham application |
| --- | --- | --- | --- |
| **streaming** | supported (protocol-structural for `/api/chat`) | supported — only transport; NDJSON frames parsed, heartbeats skipped | supported (A6 dispatch, A7 streaming/recovery) |
| **thinking** | **supported** — declared + control record above | received; `message.thinking` frames are decoded but discarded — skipped without panicking since `5d74097`; not persisted | not surfaced; **→ #32** owns thinking status/UI (A5 review item: ThinkingDelta storage deferred) |
| **tools** | **supported** (declared) | adapter never sends a `tools` parameter; response `tool_calls` frames are ignored as unknown fields (safely skipped post-`5d74097`, no panic) | none; **→ #32** owns tool/conversation integration. Nothing is auto-enabled. |
| **vision** | **supported** (declared) | not represented in the capability struct today (see §3); response `message.images` ignored; no request path for images | composer has a dormant `supportsVision` prop (compose attachment menu) — default `true`, no caller supplies it, so the "no vision" warning is inert; **→ #32** owns rich input + wiring |
| **completion** | supported | base chat path | conversation flow (A6/A7) |
| **structured_output** | not declared in `/api/show` → **unknown** per contract (no wire evidence; not probed) | unknown; adapter never sends `format` | none; may be evidenced later by a bounded probe if #32 wants it |

Nothing in any surface claims thinking/tools/vision are *unsupported*: the settings
rows render exactly what the registry records (`supported`/`unknown`); the composer's
vision warning is dormant.

## 3. Metadata currently dropped (per hop)

| Wire field (from `/api/tags` + `/api/show`) | Discovery (adapter) | Registry (`descriptor_json`) | DTO (`ProviderModelDto`) | UI |
| --- | --- | --- | --- | --- |
| name | ✓ model_id | ✓ | ✓ | ✓ |
| digest | ✓ | ✓ | ✓ | ✓ (prefix) |
| `capabilities` → tools | ✓ `tool_proposals` | ✓ | ✓ | ✓ chip |
| `capabilities` → thinking | ✓ `thinking` | ✓ | ✓ | ✓ chip |
| `capabilities` → streaming | ✓ (structural) | ✓ | ✓ | ✓ chip |
| structured_output | always `unknown` (by contract) | ✓ | ✓ | no chip |
| `capabilities` → **vision** | ✗ dropped (no struct field) | — | — | — |
| `capabilities` → completion | ✗ dropped | — | — | — |
| `thinking` control record (values/default) | ✗ only the derived value kept | — | — | — |
| `qwen3_5.context_length` (262144) | ✗ dropped (model_info unread) | — | — | — |
| details (family, parameter_size `852.88M`, quantization `mxfp8`, runner `mlx`, format) | ✗ dropped | — | — | — |
| model_info extras (architecture, block/embedding) | ✗ dropped | — | — | — |
| `requires` (0.19.0) | ✗ dropped | — | — | — |
| blob size / modified_at (tags+show) | ✗ dropped | — | — | — |

Reader tolerance confirmed: `registry.rs` decodes descriptors with plain serde —
unknown JSON keys are ignored on read, so **additive** descriptor keys are safe for
existing rows; new writes may carry the extra fields without breaking old readers.
The DTO hop is the next bottleneck: it exposes exactly the 4 existing keys.

Adapter-level mapping inconsistency to resolve jointly (flagged, not landed):
`map_show_capabilities` maps `tools` **absent-in-list → Unsupported** while its
comment claims unknown; `thinking` absent → Unknown. One consistent evidence rule
should cover tools, vision and thinking alike (Ollama's `capabilities` list is the
authority when present; the show-call-fails fallback already maps everything unknown).

## 4. Proposed shared contract delta — needs #32 coordination (not landed here)

Provider-side (discovery/adapter evidence):

```rust
pub struct ModelCapabilities {
    pub streaming: CapabilityStatus,
    pub structured_output: CapabilityStatus,
    pub tool_proposals: CapabilityStatus,
    pub thinking: CapabilityStatus,
    pub vision: CapabilityStatus, // NEW: has("vision") tri-state
}
// descriptor additions:
//   context_length_declared: Option<u64>        (model-declared only; None when absent)
//   thinking_control: Option<ThinkingControl>   ({values: Vec<bool>, default: Option<bool>})
```

Shared DTO (regenerate `packages/contracts-generated`):

```ts
ProviderCapabilitiesDto += vision: string              // 'supported' | 'unknown' | 'unsupported'
ProviderModelDto += contextLengthDeclared: number | null
// nullable = "wire said nothing" — never a fabricated fallback
```

#32 consumption points: composer thinking status (thinking control + record), tool
gating (`tool_proposals` only), rich input (`vision` → `supportsVision` prop),
model-limit display (declared vs effective context, labeled distinctly).

Hard rules for whoever lands it: data-driven mapping only (no
model-name exceptions anywhere, tests included except fixtures), `unknown` stays
`unknown`, tools never auto-enabled, no fabricated context values.

## 5. Ownership summary (per the closure directive)

- **Provider teammate (this delivery):** discovery/adapter evidence ✓ (this document),
  `5d74097` frame robustness ✓, registry persistence of recorded capabilities ✓.
- **#32 teammate:** composer behavior, thinking status, rich input transport,
  tool/conversation integration, judgement of `vision`/context consumer UX, and the
  joint DTO migration listed in §4.
- **Do not do automatically (either side):** enabling tools, treating declared-but-
  unsigned-off capabilities as app features, asserting effective context without a
  wire source.
