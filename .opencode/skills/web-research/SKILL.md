---
name: web-research
description: Use when collecting info, answering docs questions, or searching the web. Triggers on research, lookup, docs, search, YouTube, GitHub, Twitter, Reddit, Bilibili, Xiaohongshu. Combines Context7 MCP with agent-reach CLI.
---

# Web Research

Main info-collecting skill. Use every time before answering factual / docs / web questions.

## 1. Context7 (docs)

- Library / framework / API question -> Context7 MCP first.
- `resolve-library-id` -> `get-library-docs`.
- No key needed. Key `CONTEXT7_API_KEY` (`ctx7sk_...` from https://context7.com/dashboard) only raises rate limits.
- Local config uses `"CONTEXT7_API_KEY": "{env:CONTEXT7_API_KEY}"` — never hardcode the key.

## 2. agent-reach (live internet)

Repo: https://github.com/Panniantong/agent-reach
Install doc: https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/install.md

```powershell
pip install https://github.com/Panniantong/agent-reach/archive/main.zip
agent-reach install --env=auto
agent-reach doctor
```

Zero-config channels: web (Jina), YouTube, GitHub public, RSS, Exa search, V2EX, Bilibili basic.
Login channels (ask user, then enable): `opencli, twitter, xiaohongshu, reddit, facebook, instagram, bilibili, linkedin, boss`.

```bash
agent-reach install --env=auto --system --channels=opencli,xiaohongshu
agent-reach doctor
```

## 3. Answer format

- Context7 docs summary + live results.
- Sources: URLs for web, `file:line` for repo.
- If channel down: report `agent-reach doctor` output, don't hallucinate.
