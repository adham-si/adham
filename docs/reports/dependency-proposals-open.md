# Open dependency proposals

- **Date:** 2026-10-19
- **Base revision:** `d830626` (HEAD) plus uncommitted worktree changes.
- **Scope:** dependencies considered for conversation 01 and deliberately not added. This register records proposals only; no manifest or lockfile was changed in this round.
- **Policy:** Engineering section 9 requires each accepted dependency to record purpose/owner, license, maintenance, security history, transitive impact, native build implications, cross-platform support, standard-library sufficiency, and exit strategy (`docs/Engineering — Initial repository architecture-and-setup instructions.md:532-542`). None of the candidates below reached that record because each is deferred.

| Need | Candidate | License | Why deferred | Decision |
|---|---|---|---|---|
| PDF text extraction for text-based PDFs | `pdf-extract` (pure Rust) | MIT | The current slice handles text and code only; PDF parsing adds a parser and transitive surface and needs a retention/trust review before content handling. Not needed for the current vertical slice. | not added — human decision 2026-10-19: skip for this round |
| Fenced-code syntax highlighting | `prism-react-renderer` (MIT), `highlight.js` (BSD-3), `shiki` (MIT) | MIT / BSD-3 / MIT | The renderer already provides a language label and a copy-code control (`packages/ui/src/markdown-view.tsx:311-352`); highlighting adds theme, bundle-size, and maintenance choices without changing the current reading or copy behavior. | not added — human decision 2026-10-19: skip for this round |

Licenses are the candidates' declared licenses as recorded when the proposals were raised; no further license audit was run because nothing was added. Reconsider when a PDF ingestion slice or a highlighting requirement is scheduled; each candidate then needs the full section 9 record and human approval before install.
