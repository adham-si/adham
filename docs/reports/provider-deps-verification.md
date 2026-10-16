# Provider dependency verification (Delivery A)

P0 gate fields per dependency: exact version + registry, license, release status,
Node/Rust/Tauri/Vite compatibility, transitive count + native build impact,
known vulnerabilities + maintenance signals, features enabled vs deliberately disabled.

## reqwest (direct, added for A)

- Exact version: 0.13.5 (lock-unified; single reqwest in tree)
- Registry: crates.io
- License: MIT OR Apache-2.0; rust_version 1.85.0 (≤ CI 1.96.0)
- Release status: stable 0.13.x line
- Compatibility: Rust 1.96.0 CI toolchain OK; pure-Rust TLS (rustls 0.23.46 + aws-lc-rs 1.18.1 + aws-lc-sys 0.45.0), no OpenSSL linkage on desktop targets
- Transitive count + native build impact: adham-provider normal tree = 152 nodes added/affected; NEW crates compiled into it: aws-lc-sys (C/asm build via cmake/cc — build-time only), ring, rustls, hyper-rustls, tokio-rustls, rustls-platform-verifier (+android variant records jni in lock), time, quinn*
- Vulnerabilities/maintenance: RustSec checked against locked versions — reqwest: no advisories; rustls 7 advisories ALL patched (4 from 2026-10-14 require ≥ 0.23.46 — lock has exactly 0.23.46); aws-lc-sys 5 advisories patched (≥ 0.39.0 < 0.45.0); tokio-rustls 0.26.6 far past its 2020 advisory (≥ 0.13.1); ring 0.17.14 ≥ 0.17.12 (RUSTSEC-2025-0009); ring RUSTSEC-2025-0007/0010 are maintenance-status notices (not vulns in 0.17); hyper-rustls/aws-lc-rs/rustls-platform-verifier: none; quinn@0.11.12 only advisory affects < 0.7
- quinn*: present in Cargo.lock but unreachable in adham-provider's normal tree even with --target all — inert lock entry pulled by the workspace universe (Tauri), not compiled, no exposure. Ruling: leave as-is; cargo-deny/ci will not trip it.
- cargo-deny: not installed locally; CI `cargo deny check` remains the authoritative vuln/license/license gate — this file is the pre-verification evidence only.
- Features enabled: `json`, `stream`, `rustls` (aws-lc + platform verifier); default features OFF (no charset/http2/system-proxy — no ambient proxy by construction)
- Deliberately disabled/refused: `eventsource-stream` (hand-rolled SSE instead), `async-openai` (hides wire behavior), `tauri-plugin-http` (frontend must never do provider HTTP), `rustls-tls-manual-roots` (not a public 0.13 feature — verified in crate source)

## tokio-util (direct, added for A)

- Exact version: 0.7.19 (lock-unified; 0.7.20 exists upstream but resolver pinned 0.7.19 — acceptable, same 0.7 line)
- Registry: crates.io
- License: MIT; rust_version 1.71 (≤ CI 1.96.0)
- Release status: stable 0.7.x line
- Compatibility: pairs with locked tokio 1.53.2
- Transitive count + native impact: pure Rust, no native build
- Vulnerabilities/maintenance: no RustSec advisories for tokio-util
- Features enabled: none (`default = []`; `sync::CancellationToken` is ungated — verified in crate source)
- Deliberately disabled: n/a
