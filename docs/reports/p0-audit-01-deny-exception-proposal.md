# P0-AUDIT-01 — Dependency exception record: RUSTSEC-2024-0370

Status: APPROVED AND APPLIED (risk-disposition approval, PR #1 review).
This is not merge approval or P1 readiness.

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
`glib-macros`. It is not linked into the shipped runtime binary — but that
does not mean harmless. Compromised build tooling can affect shipped
artifacts, which is exactly why this exception is time-limited, tracked,
and enforced rather than open-ended.

## 3. Full evidence capture (sanitized)

- Tested tree: audit branch `audit/p0-audit-01-verification-errors` at the
  commit carrying this change (see handoff); runner paths below are
  normalized to `<repo>`.
- Toolchain: `cargo-deny 0.20.2`.
- Advisory DB: commit `550efd3d587a29b2e2c2b21b17a440da4fede999`, timestamp
  `2026-10-08T16:47:14+02:00` (local cache; CI fetches the current DB at run
  time, so later runs may surface new advisories — none are suppressed by
  this change).
- Full `cargo deny check` result before applying the ignore (exit non-zero
  from the advisories linter only):

```
error[unmaintained]: proc-macro-error is unmaintained
  advisory: RUSTSEC-2024-0370 (https://rustsec.org/advisories/RUSTSEC-2024-0370)
  crate: proc-macro-error v1.0.4 (<repo>/Cargo.lock:226)
  path: proc-macro-error 1.0.4 <- glib-macros 0.18.5 <- glib 0.18.5
    <- gtk 0.18.2 <- muda 0.20.0 / tao 0.37.1 / wry 0.57.0
    <- tauri 2.12.1 <- adham-desktop
  remediation per advisory: none ("No safe upgrade is available!")

bans ok, licenses ok, sources ok
```

- After applying the ignore below: `advisories ok, bans ok, licenses ok,
  sources ok`, exit 0, verified locally. No other advisory, ban, license,
  or source finding exists in this tree.

## 4. Narrow-update assessment: none exists

- `proc-macro-error` is final at 1.0.4 (maintainer unreachable); no patch
  release can resolve the advisory.
- gtk-rs already removed it on the 0.19 line (`glib-macros 0.19.x` has no
  such dependency; gtk-rs-core#1288, June 2024 release notes).
- Our tree cannot take that line: Tauri 2.12.1 pins the 0.18 line
  (`muda 0.20.0`, `tao 0.37.1`, `wry 0.57.0` all require `gtk ^0.18`).
  Adopting it means a Tauri-side migration, which is not a narrow,
  compatible update. No GTK/Tauri migration is started by this task.

## 5. Exception record (this advisory ID only, APPROVED and APPLIED)

- Scope: `RUSTSEC-2024-0370` only. No blanket advisory allowance; the
  `advisories` gate stays enforced for everything else.
- Owner: ilyass (repository maintainer).
- Review date: 2027-01-06 (90 days from 2026-10-08). Enforced by
  `scripts/check-deny-exceptions.mjs`, which fails on or after the deadline
  unless approval is renewed or the exception and its ignore are removed;
  wired into `pnpm check` and CI.
- Upstream tracking: gtk-rs removal complete on the 0.19 line
  (gtk-rs-core#1288, June 2024 release notes); Tauri adoption of gtk-rs
  0.19 pending — tracked via PR #1 review threads
  (https://github.com/adham-si/adham/pull/1#issuecomment-6068235161,
  https://github.com/adham-si/adham/pull/1#issuecomment-6068792394). No
  invented upstream issue.
- Removal condition (any): `proc-macro-error` absent from `Cargo.lock`,
  Tauri upgrade replacing the gtk 0.18 line, or advisory withdrawal. The
  validator fails if the locked crate/version drifts, forcing re-scope.
- Applied snippet in `deny.toml` (schema validated locally against
  cargo-deny 0.20; advisory ignores accept `id` + `reason` only — there is
  no machine-readable expiry, so the time bound lives in
  `deny-exceptions.json` plus this document and the owner):

```toml
[advisories]
ignore = [
    { id = "RUSTSEC-2024-0370", reason = "P0-AUDIT-01 time-limited exception, reapproval due 2027-01-06 (deny-exceptions.json)" },
]
```

- Verification after application: `cargo deny check advisories` exits 0
  with no `error[unmaintained]` entry (verified locally).
