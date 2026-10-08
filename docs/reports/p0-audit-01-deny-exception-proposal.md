# P0-AUDIT-01 — Dependency exception proposal: RUSTSEC-2024-0370

Status: PROPOSED, NOT APPLIED. Requires explicit audit-lead approval before
any `deny.toml` change. `deny.toml` in this tree is unmodified.

## 1. Advisory record

- ID: RUSTSEC-2024-0370 — https://rustsec.org/advisories/RUSTSEC-2024-0370
- Kind: `unmaintained` (informational). NOT a disclosed vulnerability; no CVE.
- Crate: `proc-macro-error v1.0.4` (locked in `Cargo.lock:226`).
- Upstream states: "No safe upgrade is available." Alternatives named by the
  advisory: `manyhow`, `proc-macro2-diagnostics` (both require downstream
  migration, not a version bump).

## 2. Locked dependency path (all via Tauri 2.12.1)

`proc-macro-error 1.0.4` ← `glib-macros 0.18.5` ← `glib 0.18.5` ←
`gtk 0.18.2` ← `muda 0.20.0` / `tao 0.37.1` / `wry 0.57.0` ← `tauri 2.12.1`
← `adham-desktop`. Verified with `cargo tree -i proc-macro-error
--target all` (the default host-target tree prunes this branch entirely).

Target confirmation: `deny.toml [graph]` audits all four triples
(x86_64-pc-windows-msvc, x86_64-apple-darwin, aarch64-apple-darwin,
x86_64-unknown-linux-gnu), so the GTK chain is audited on every runner
including Windows. Host-only `cargo tree` hides it; deny does not.

Exposure note: `proc-macro-error` is a proc-macro used at build time by
`glib-macros`. It is not linked into the shipped runtime binary. The risk
is supply-chain hygiene (an unmaintained build dependency with no future
fixes), not runtime exploitability.

## 3. Full current `cargo deny check` capture (audit branch)

Exactly one error: `error[unmaintained]` above. `bans ok, licenses ok,
sources ok`. Remaining output is `warn`-level duplicate-version notices
(Tauri/sqlx/gtk major-version coexistence), which do not fail the gate.

## 4. Narrow-update assessment: none exists

- `proc-macro-error` is final at 1.0.4 (maintainer unreachable); no patch
  release can resolve the advisory.
- gtk-rs already removed it on the 0.19 line (`glib-macros 0.19.x` has no
  such dependency; gtk-rs-core#1288, June 2024 release notes).
- Our tree cannot take that line: Tauri 2.12.1 pins the 0.18 line
  (`muda 0.20.0`, `tao 0.37.1`, `wry 0.57.0` all require `gtk ^0.18`).
  Adopting it means a Tauri-side migration, which is not a narrow,
  compatible update. No GTK/Tauri migration is started by this task.

## 5. Exception proposal (this advisory ID only)

- Scope: `RUSTSEC-2024-0370` only. No blanket advisory allowance; the
  `advisories` gate stays enforced for everything else.
- Owner (to confirm): audit lead.
- Review date: 2027-01-06 (90 days from 2026-10-08).
- Upstream tracking: gtk-rs removal complete (0.19+); pending Tauri
  adoption of gtk-rs 0.19 (upstream issue TBD — to be linked at approval).
- Removal condition (any): `proc-macro-error` absent from `Cargo.lock`,
  Tauri upgrade replacing the gtk 0.18 line, or advisory withdrawal.
- Snippet to apply ONLY on approval (schema validated locally against
  cargo-deny 0.20; advisory ignores accept `id` + `reason` only — there is
  no machine-readable expiry, so the time bound lives in this document
  and with the owner):

```toml
[advisories]
ignore = [
    { id = "RUSTSEC-2024-0370", reason = "P0-AUDIT-01 time-limited exception, review 2027-01-06 (docs/reports/p0-audit-01-deny-exception-proposal.md)" },
]
```

- Verification after application: `cargo deny check advisories` must exit
  0 with no `error[unmaintained]` entry.
