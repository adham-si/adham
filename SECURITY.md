# Security Policy

## Reporting a Vulnerability

Adham treats the security and privacy of user data as fundamental product promises. If you believe you have discovered a vulnerability, please report it responsibly.

### Disclosure Guidelines
- **Do not open public issues** on GitHub for security vulnerabilities.
- Send vulnerability details, reproduction steps, and platform context to: `security@adham.si`.
- Provide sufficient detail to reproduce the behavior with synthetic canary data only (never include real credentials or user context).

### Scope and Invariants
Adham enforces several non-negotiable security boundaries:
1. **Local-first isolation:** The renderer cannot read files, execute shell commands, or query SQLite directly.
2. **Project-scoped containment:** Project roots are opaque directory capabilities; symlinks, junctions, and alternate data streams are rejected by default.
3. **Brokered credentials:** Provider secrets are never embedded in repository files, project configuration, model prompts, or diagnostics.
4. **Immutable event log:** Commands cannot arbitrarily append events or bypass application validations.
