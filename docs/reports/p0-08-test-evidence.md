# P0-08 Provider Gateway & Normalized Stream Contract Evidence Report

**Specification:** [`docs/spec/p0/P0-08 — Provider gateway and normalized stream contract.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0-08%20%E2%80%94%20Provider%20gateway%20and%20normalized%20stream%20contract.md)  
**Governing Documents:** [`AGENTS.md`](file:///c:/Users/IronMan/Desktop/adham.si/AGENTS.md), [`p0-08-provider-gateway-plan.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/setup/p0-08-provider-gateway-plan.md)  
**Date:** 2026-10-07  
**Status:** **100% PASSED & VERIFIED**  

---

## 1. Executive Summary

This report documents the verification evidence for the **Provider Gateway & Normalized Stream Contract** milestone (P0-08).

P0-08 establishes Adham's provider-neutral gateway and streaming abstraction (`adham-provider`):
- **Providers Supply Output, Not Authority:** Requests are bound to immutable execution identities, approved accounts, and validated endpoints.
- **Privacy Boundaries:** Strict enforcement of `LocalOnly` privacy classes preventing data transmission to remote or non-loopback endpoints.
- **Endpoint Security Policy:** Plain HTTP is strictly restricted to local loopback addresses (`127.0.0.1`, `localhost`, `[::1]`); remote services require validated TLS.
- **Normalized Stream Contract:** Common streaming event lifecycle (`StreamStarted`, `TextDelta`, `ThinkingDelta`, `Progress`, `StreamCompleted`).
- **Wire Adapters:** High-fidelity NDJSON streaming parser for Ollama `/api/chat` and deterministic mock protocol fixtures.
- **Runtime Bridge:** `ProviderGateway` implements `adham-runtime::ports::model::ModelPort`, directly powering single-agent driver loops.

---

## 2. Verified Invariants & Test Scenarios

### 1. Ollama NDJSON Streaming Protocol Parser
- **Verified in `test_ollama_ndjson_stream_parsing` (`protocol_tests.rs`):**
  - Parses streaming NDJSON lines from Ollama's `/api/chat` API.
  - Normalizes message content into incremental `TextDelta` events.
  - Accurately captures prompt and completion token counts from the final chunk into `Progress(StreamUsage)`.
  - Maps `done: true` to `StreamCompleted(StreamCompletionOutcome::Stop)`.
  - Rejects malformed JSON with `ProtocolParseError`.

### 2. Endpoint Loopback & TLS Enforcement
- **Verified in `test_endpoint_loopback_validation` (`privacy_boundary_tests.rs`):**
  - Loopback endpoints (`http://localhost:11434`, `http://127.0.0.1:11434`) are permitted over HTTP.
  - Remote plain HTTP endpoints (`http://api.external.com`) are rejected with `EndpointPolicyViolation`.
  - Remote endpoints require HTTPS (`https://api.openai.com/v1`).

### 3. Privacy Boundary Enforcement
- **Verified in `test_privacy_class_boundary_enforcement` (`privacy_boundary_tests.rs`):**
  - Attempting to dispatch a `LocalOnly` request to a remote/cloud endpoint is rejected by `ProviderGateway` with `PrivacyBoundaryViolation`.
  - Prevents implicit or accidental local-to-cloud data leakage.

### 4. End-to-End Runtime Integration
- **Verified in `test_provider_gateway_runtime_integration` (`gateway_runtime_tests.rs`):**
  - Connects `ProviderGateway` directly to `AgentDriver` from `adham-runtime`.
  - Executes a single-agent reasoning turn end-to-end: driver claims run -> gateway validates policy and streams output -> driver aggregates text and token usage -> verifier confirms evidence -> run terminates as `Completed`.

---

## 3. Test & Governance Results

- **Provider Tests (`adham-provider`):** **5/5 passed.**
  - `protocol_tests.rs`: 2/2 passed.
  - `privacy_boundary_tests.rs`: 2/2 passed.
  - `gateway_runtime_tests.rs`: 1/1 passed.
- **Full Rust Workspace (`cargo test --workspace`):** **77/77 passed.**
- **Contract Drift Check (`cargo xtask contracts --check`):** **PASSED (0 drift).**
- **File-Size Audit (`node scripts/check-file-size.mjs`):** **0 warnings (>400 lines), 0 errors (>600 lines).**
  - All files in `adham-provider` strictly `<120` lines.
- **Formatters & Linters:** `cargo fmt --check` clean, desktop oxlint clean with 0 warnings/errors.
