# Contributing to Adham

Thank you for helping build Adham!

## Architecture Rules
1. **Domain-driven modular monolith:** Do not introduce network microservices for in-process boundaries.
2. **Thin Tauri commands:** The command layer validates transport input and calls application use cases; it contains no domain logic.
3. **No direct renderer access:** The frontend communicates with Rust strictly through typed IPC and `shared/api/adham-client.ts`.
4. **File-size limits:** Target <300 lines per production source file, review >400 lines, hard failure >600 lines.
5. **No secrets in repository:** Never commit API keys, credentials, or private paths.

## Development Workflow
1. Ensure all prerequisites are installed (Rust 1.85+, Node 24 LTS, pnpm 10.33.2).
2. Run validation scripts before submitting changes:
   ```bash
   pnpm format:check
   pnpm lint
   pnpm typecheck
   cargo fmt --all -- --check
   cargo clippy --workspace --all-targets --all-features -- -D warnings
   cargo test --workspace
   ```
3. Use conventional commit messages (`feat`, `fix`, `refactor`, `test`, `docs`, `build`, `security`).
