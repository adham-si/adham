---
description: Draft a conventional commit message from staged changes.
---

Generate a conventional commit message from `git diff --staged`.

Rules:
- Format: `<type>(<scope>): <subject>` when scope is clear, else `<type>: <subject>`
- Types: feat, fix, chore, docs, refactor, test
- Subject <= 72 chars, imperative, no period
- Output only the message, in a code block

Context:
$ARGUMENTS
