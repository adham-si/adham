---
name: project-conventions
description: Use when working in this repo to follow local conventions, file layout, and opencode workflow. Triggers on repo tasks, new files, or commands.
---

# Project Conventions

Local-only starter skill. Keep it short.

- Instructions live in `AGENTS.md`.
- Commands live in `.opencode/command/*.md`, invoked as `/command-name`.
- Plugins auto-load from `.opencode/plugin/*.ts`.
- MCP servers are declared in `opencode.json` under `mcp`.
- Prefer `opencode.json` for project-local config only. Never edit global `~/.config/opencode`.
