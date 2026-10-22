# Dependency record — `pdf-inspector` (section-9, pre-install)

Date: 2026-10-22. Written for the Stage-1 changeset on `feat/conversation-02-pdf` (this doc commits with that changeset; that commit is the revision any gate claim must cite). **No parser is installed in this stage.** Everything below is verified against primary sources today (crates.io API, docs.rs, GitHub API, RustSec advisory-db, upstream source at tag `v1.25.2`).

## Identifiers

| Field | Value |
|---|---|
| Crate | `pdf-inspector` |
| Exact pin proposed | **1.25.2** — newest published version (`2026-09-28T06:56:49Z`), 26 versions, none yanked |
| License | MIT |
| MSRV | `rust_version: 1.88` (workspace pins Rust 1.96.0 in CI — comfortably above) |
| Linkage | pure Rust; no dylib/static artifact needed |
| Upstream repo | `firecrawl/pdf-inspector` (GitHub org, verified; 19.7k stars / 1.3k forks / 250 open issues) |
| Publish path | crates.io **trust-pub** via GitHub Actions from `firecrawl/pdf-inspector`, release commit `ef52f778` = the `v1.25.2` tag |

## Ownership / bus factor

- crates.io owner: **exactly one user** — `abimaelmartell` (no teams). Single-publisher concentration is real but publishing is org-trust-pub from the Firecrawl org repo, so supply chain is anchored to the org's GitHub CI.
- If the project disappears: crate remains on crates.io (pullable), but upstream fixes (PRs #610/#611) merge nowhere. This is the shipping-risk decision the PM is holding open.

## Runtime dependency surface (exact, at 1.25.2)

Default features: **none** (`features: []`) — so a plain dependency pulls exactly:

- Normal, non-optional (11 distinct / 12 manifest rows): `env_logger ^0.11`, `include_dir ^0.7`, `log ^0.4`, `lopdf ^0.45.0` (two target rows: wasm32 with `default_features=false, wasm_js`; non-wasm default + `rayon`), `once_cell ^1.19`, `rayon ^1.10`, `regex ^1.10`, `thiserror ^2.0`, **`ttf-parser ^0.25`**, `unicode-bidi ^0.3`, `unicode-normalization ^0.1`.
- Optional (10, feature-gated, **all stay unused by us**): `dirs`, `firecrawl-pdfium`, `fs2`, `image`, `oar-ocr`, `ort`, `pyo3`, `sha2`, `ureq`, `windows-sys ^0.61`. Features mapping: `model-cache`→dirs/fs2/sha2/windows-sys; `ocr`→render-pdfium+ocr+model-cache; `python`→pyo3. We must never enable `ocr`, `python`, `render-pdfium`, `model-cache`.
- Dev-only: `tempfile ^3.3` (not part of runtime graph).
- Transitive graph today (researcher's reproduction resolving `^` reqs on the default-feature path): **86 unique packages**, including `ttf-parser 0.25.1`, `lopdf 0.45.0`, `regex 1.13.1`, `thiserror 2.0.21`, `env_logger 0.11.11`, `include_dir 0.7.4`, `once_cell 1.21.4`, `unicode-bidi 0.3.18`, `unicode-normalization 0.1.26`. No vendor publishes a transitive count; 86 is our measured resolution and must be re-measured at install and each bump.

## Advisories

- `pdf-inspector` itself: **no advisories** (no entry in RustSec advisory-db; crates.io exposes no advisories metadata for it).
- `ttf-parser`: **RUSTSEC-2026-0192**, informational **unmaintained** (2026-06-28). No `patched`/`affected` ranges — every published ttf-parser version, including the `0.25.1` this pin resolves to, sits in scope. Upstream issue: harfbuzz/ttf-parser#217; suggested alternative `skrifa`. Consequence: **not fixable in our tree or upstream's**; it is schedule/ban risk (an org dependency-audit policy may ban unmaintained crates), not a known vulnerability claim. Must be named in the accept-risk decision.

## Known open exploit classes (the actual risk)

| PR | Class | Status (2026-10-22) |
|---|---|---|
| #610 | flate-bomb → OOM (fix: 64 MiB page-content byte budget) | open, clean, author-created 2026-09-30, last activity 2026-10-12; **no maintainer timeline comment** |
| #611 | deep Form/XObject chain → stack overflow (fix: depth cap 64; stacked on #610) | open, same dates; **no maintainer timeline comment** |

No tag newer than `v1.25.2` (`ef52f778`); main is one unreleased fix ahead (`#618`, tounicode, 2026-10-07). On any released version, hostile PDFs can OOM or abort the parsing **process** — acceptable only because that process is the island.

## API surface (for the later wiring stage, quoted from tag `v1.25.2`)

- `extract_pages_markdown<P: AsRef<Path>>(path, pages: Option<&[u32]>) -> Result<PagesExtractionResult, PdfError>`; `page` field in `PageMarkdown` is **0-indexed**; struct fields `page:u32, markdown:String, needs_ocr:bool, ocr_reason:Option<String>`; result carries `pages_needing_ocr`, `is_complex`. A `_mem` twin takes `&[u8]` — that is the variant the island should use with stdin bytes (matches our no-path-capability wall).
- `extract_text_with_positions` re-exported; `TextItem` (24 fields incl. positions/colors/mcid/baseline) with **1-indexed** `page` — note the index divergence between the two APIs if both are used.
- Errors: single `PdfError` enum — `Io`, `Parse`, `Encrypted`, `InvalidStructure`, `NotAPdf(String)`; `From<lopdf::Error>` (decryption/password → `Encrypted`). This decides our status mapping honestly: if corrupt-vs-encrypted is not distinguishable in practice, both collapse to `pdfUnreadable` (per design).
- `ProcessMode`/`PdfOptions{mode, detection, markdown, page_filter, password}` exist; `detect_pdf` metadata-only. User-facing page limits exist (`pages`/`page_filter`); decode budgets are internal and fixed: `MAX_PAGE_CONTENT_BYTES = 64 MiB`, `MAX_PAGE_OPERATIONS = 1_000_000`.

## Decision hooks

- **Install requires explicit authorization** (Stage-2 gate). Anything changed after signature: version bump, new feature, upstream release ⇒ re-open this record.
- Accept-risk rationale to be signed against PRs #610/#611 openness + `RUSTSEC-2026-0192` + bus factor, with the island walls (memory kill-on-limit per OS, stdin-only input, supervised caps, 30 s clock) as the stated mitigations.

---

## Proposal for isolated parser / PoC testing (Stage 2 — needs authorization)

Proposed order, all inside the island crate, none touching production wiring:

1. **Install** `pdf-inspector = "=1.25.2"` as the island's only parser dep (default features, add `cargo deny`-style license/version check to xtask if present). Re-measure the 86-package graph in `Cargo.lock` and record the delta here (~only additive nodes expected; `windows-sys 0.61` must NOT appear from us — it exists in lock for other reasons).
2. **Synthetic real-parser modes** replace/extend the fault mocks: `--self-test` (deterministic clean PDF bytes from a repo fixture string, verifies the API wiring end-to-end), statuses mapped from `PdfError`: `Encrypted` → `pdfEncrypted`/collapse-`pdfUnreadable` per distinguishability finding; `Parse`/`InvalidStructure`/`NotAPdf` → `pdfCorrupt`/collapse; stdin-bytes API (`*_mem`) only.
3. **PoC fixtures** — needs explicit approval since they are exploit artifacts:
   - #610 flate-bomb: craft a PDF with one flate-decompressed page content-stream far over 64 MiB (pure std compression at test-writer time, compressed size < 1 MiB, decompresses ~300 MiB> island budget).
   - #611 deep nesting: ~20 000 nested Form XObjects (generator script in-repo, documented, no binary blobs committed).
   - Expected: both get a per-item refusal (`MemoryLimit` via wall / clean abort → `Crash` mapped to `islandFailure`), app alive, no partial extract. These two tests are the accept-risk evidence.
4. **Fuzz target**: `cargo-fuzz` on the island stdin/protocol boundary and the parser entry (`stdin bytes → extract`), nightly-scheduled job later; CI run on Windows stays the required job (PM flag).
5. **Per-OS matrix**: same three lanes as Stage 1 (macOS host run, Ubuntu 24.04 container = declared target, `windows-latest` CI runtime on push). Memory-wall expectations differ per OS and are already encoded pass/fail per platform in the tests.
6. **No-network check** for the parser stage: island stays socket-less by construction (source tripwire test already in place); the optional `ureq` dep must remain un-enabled (verify via `cargo tree -f "{p} {f}" | grep -c ureq` = 0).
