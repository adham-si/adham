# AGENTS.md

Project instructions for opencode agents. Keep edits small and local.

- Prefer editing existing files over creating new ones.
- Explain non-obvious changes briefly.
- Do not commit secrets. Ask before `git push`.
- Match existing code style.

## Repo state

- Post-scaffold monorepo: `apps/desktop` (React 19 / Vite UI + `src-tauri` shell), `crates/` (domain, storage, projections, API, extensions, tools, etc.), `packages/` (contracts-generated, UI, design-tokens), root `package.json` (`pnpm@10.33.2`), `Cargo.toml` workspace, committed `pnpm-lock.yaml` + `Cargo.lock`. Inspect live state via `git log --oneline`, `git ls-files apps crates packages`, `cargo metadata --no-deps`. Do not hardcode commit/crate counts into instructions.
- P0 foundation under repair (atomic writes, AEAD content, scoped idempotency, durable SQLite identity). Until content protection lands on your branch, use disposable synthetic data. Real-data use is technically blocked, not merely discouraged.
- Prior `docs/reports/p0-06-*` evidence is historical; unsupported conclusions are superseded, not rewritten. New gate claims require fresh revision-tagged logs at the repaired revision.
- Stage paths explicitly — never `git add -A`; `.playwright-mcp/`, `.kilo/worktrees/`, and `.opencode/node_modules` are local scratch. `.gitignore` covers `target/`, `node_modules/`, `*.db*`, and scratch dirs.

## Sources of truth

| Need | File |
|------|------|
| Product brief | `docs/adham.md` |
| Stack, boundaries, quality rules | `docs/Engineering — Initial repository architecture-and-setup instructions.md` |
| Decision register, spec order, gates | `docs/spec/p0/P0 — Implementation decisions & execution order.md` |
| Scaffold runbook + required reports | `docs/spec/p0/P0-06 — Repository scaffold execution and evidence checklist.md` |

- Specs gate code: P0-01…P0-05 must be sufficient before scaffolding. A contradiction in a spec blocks that work — resolve it in review rather than inventing a weaker implementation.

## Quirks

- Doc filenames use an em dash `—` (U+2014), not `-`. Glob with `*P0-06*` instead of typing the name; literal paths in `read` calls fail otherwise.
- Generated files are committed but never hand-edited: `routeTree.gen.ts`, `packages/contracts-generated/`. Regenerate via the owning plugin/CLI.
- File-size policy: target <300 lines, review >400, >600 needs a documented exception.
- Evidence and reports live in `docs/reports/*.md` and must use synthetic canary data only — never user content, secrets, raw app-data paths, or key material.

## Commands

| Task | Command |
|------|---------|
| Research a topic | `/research <topic>` |
| Conventional commit message | `/commit` |
| Review the working diff | `/review` |

Bash permissions: `git *` is auto-allowed, everything else (including external directories) prompts.

## Research (always)

For any info collecting / docs / web question, use the `researcher` subagent
(`.opencode/agent/researcher.md`) and `web-research` skill
(`.opencode/skills/web-research/SKILL.md`), or run `/research <topic>`.

Order: Context7 MCP first, then agent-reach CLI (`agent-reach doctor` first).
Install: https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/install.md
Repo: https://github.com/Panniantong/agent-reach
Secrets (`CONTEXT7_API_KEY`, cookies) via env only, never in repo.
