<aside>
📁

Adham follows operating-system conventions for global application data and uses open ecosystem files inside projects wherever real standards exist. It must not invent a vendor-neutral-looking file and falsely present it as an industry standard.

</aside>

## Decision summary

Use two layers:

1. **Global Adham storage:** Private installation data, credentials, sessions, indexes, logs, caches, and app-level settings stored in the correct operating-system directories.
2. **Project-local portable configuration:** Existing open conventions such as `AGENTS.md` and Agent Skills. Adham-specific runtime state stays outside the repository unless the user explicitly exports a portable project profile.

This prevents every project from gaining a large `.adham/` directory while still allowing Adham to understand shared instructions and skills.

# 1. What is genuinely unified today

## AGENTS.md — yes, open and cross-tool

`AGENTS.md` is the strongest current convention for project instructions. It is plain Markdown, supports root and nested files, and is recognized by a broad set of coding agents. The closest file to the code being modified takes precedence.[[1]](https://agents.md/)

Recommended contents:

- Project purpose and architecture.
- Setup and development commands.
- Build, test, lint, and verification requirements.
- Coding conventions.
- Security constraints.
- Pull-request and commit rules.
- Important directories and boundaries.
- Actions agents must never perform.

Recommended placement:

```
project/
├── AGENTS.md
├── packages/
│   ├── desktop/
│   │   └── AGENTS.md
│   └── runtime/
│       └── AGENTS.md
└── ...
```

Adham should read root and applicable nested `AGENTS.md` files. It should never rewrite one automatically without an explicit user action.

## Agent Skills — format yes; discovery path only partly unified

The open Agent Skills specification defines a skill as a directory containing a required `SKILL.md`, with optional `scripts/`, `references/`, and `assets/`. `SKILL.md` uses YAML frontmatter plus Markdown instructions.[[2]](https://agentskills.io/specification)

```
skill-name/
├── SKILL.md
├── scripts/
├── references/
└── assets/
```

The skill format is standardized. However, not every client discovers project skills from exactly the same parent directory.

Use this preferred portable convention:

```
project/
└── .agents/
    └── skills/
        └── code-review/
            ├── SKILL.md
            ├── scripts/
            ├── references/
            └── assets/
```

Adham should support `.agents/skills/` first, then import or map known tool-specific locations without copying them automatically.

## Existing software-project conventions

Adham should understand established project files instead of duplicating them:

- `README.md` — Human project overview.
- `CONTRIBUTING.md` — Contribution workflow.
- `SECURITY.md` — Vulnerability and security practices.
- `CODEOWNERS` — Review ownership where supported by the repository host.
- `LICENSE` — Licensing.
- `CHANGELOG.md` — Release history.
- `.editorconfig` — Editor formatting conventions.
- `.gitignore` and `.gitattributes` — Repository behavior.
- Package manifests and lockfiles — Dependencies and commands.
- CI configuration — Authoritative automated checks.
- Container and development-environment files — Reproducible execution.

These are not all AI-agent standards, but they are portable sources of truth that Adham should inspect rather than recreate.

# 2. What is not unified yet

## MCP project configuration

MCP standardizes communication between hosts, clients, and servers. It does **not** currently give every desktop agent one universal project configuration filename and directory.

Different products use locations such as:

- `.mcp.json`
- `.vscode/mcp.json`
- `.cursor/mcp.json`
- Product-specific configuration directories

Adham should:

1. Detect supported existing configurations.
2. Show an import preview.
3. Strip or separately secure secrets.
4. Convert them into Adham’s internal connection model.
5. Avoid writing changes back into another product’s file unless the user explicitly exports to that format.

Do not call `.agents/mcp.json` an industry standard unless it becomes one through an open specification.

## Agent definitions, workflows, policies, memory, and task graphs

There is no single mature universal project format covering all of these:

- Agent identities and organizational roles.
- Multi-agent reporting structure.
- Workflow graphs.
- Approval and governance policies.
- Memory databases and embeddings.
- Session logs and checkpoints.
- Model-routing policies.
- Provider-account grants.

Adham can create an open format later, but v1 should distinguish a proposed Adham format from an established standard.

# 3. Recommended global paths

Use reverse-domain application identifier:

```
si.adham.desktop
```

Secrets are never stored as ordinary configuration files.

## macOS

Apple recommends Application Support for application-specific support and managed data, with regenerable data kept in Caches.[[3]](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPFileSystem/Articles/WhereToPutFiles.html)

```
~/Library/Application Support/si.adham.desktop/
├── config/
├── data/
├── workspaces/
├── projects/
├── sessions/
├── indexes/
├── plugins/
└── backups/

~/Library/Caches/si.adham.desktop/
~/Library/Logs/si.adham.desktop/
```

Credentials: macOS Keychain.

## Windows

```
%APPDATA%\Adham\
├── config\
└── user-preferences\

%LOCALAPPDATA%\Adham\
├── data\
├── workspaces\
├── projects\
├── sessions\
├── indexes\
├── plugins\
├── cache\
├── logs\
└── backups\
```

Credentials: Windows Credential Manager or DPAPI-protected vault.

Roaming configuration should stay small. Machine-specific indexes, models, sandboxes, logs, and caches belong under Local AppData.

## Linux

Follow the XDG Base Directory specification rather than creating `~/.adham`. XDG separates configuration, durable data, state, cache, and runtime files.[[4]](https://specifications.freedesktop.org/basedir/latest/)

```
$XDG_CONFIG_HOME/adham/    # default ~/.config/adham
$XDG_DATA_HOME/adham/      # default ~/.local/share/adham
$XDG_STATE_HOME/adham/     # default ~/.local/state/adham
$XDG_CACHE_HOME/adham/     # default ~/.cache/adham
$XDG_RUNTIME_DIR/adham/    # sockets and temporary runtime objects
```

Suggested mapping:

- Config: preferences and non-secret configuration.
- Data: plugins, workspace metadata, durable databases, indexes, and backups.
- State: logs, histories, session state, recent items, and recovery state.
- Cache: downloads, temporary model artifacts, thumbnails, and rebuildable indexes.
- Runtime: sockets, locks, and current-process communication.

Credentials: system Secret Service/libsecret-compatible store when available, with an encrypted fallback.

# 4. Recommended project behavior for v1

## Standards-first default

Adham should not write a branded directory into every opened project.

By default it may read:

```
project/
├── AGENTS.md
├── .agents/
│   └── skills/
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
├── CODEOWNERS
├── .editorconfig
├── package manifests and lockfiles
├── CI configuration
└── existing supported MCP configurations
```

Mutable private data remains in Adham’s global data directory, indexed by a stable project identity.

## Project identity

Do not rely only on an absolute path, because projects move.

Recommended identity inputs:

- Repository root.
- Git remote when present.
- Repository-internal stable identifier generated by Adham but stored globally.
- Filesystem identity where available.
- User confirmation when several locations appear to represent the same project.

The identity maps global private state to the project without adding hidden files to the repository.

# 5. Optional portable Adham profile

Some settings should travel with a project and be shared with a team. Offer an explicit action:

**Export portable project configuration**

Until there is a real ecosystem standard, use a clearly namespaced location:

```
project/
└── .agents/
    └── adham/
        ├── project.yaml
        ├── agents/
        ├── workflows/
        ├── policies/
        └── README.md
```

Why `.agents/adham/` instead of pretending `.agents/project.yaml` is standard:

- `.agents/` communicates the general agent ecosystem.
- `adham/` honestly identifies the current schema owner.
- Other tools can ignore the namespace safely.
- Adham can later migrate to an open shared schema if one gains adoption.
- It avoids collisions with another tool’s interpretation of generic files.

The portable profile must never include:

- API keys or credentials.
- Private memory contents.
- Embeddings or vector databases.
- Session transcripts.
- Absolute private filesystem paths.
- Unredacted logs.
- Machine-specific sandbox state.

# 6. Local-only project data

If the user explicitly wants project-local private state, Adham may create:

```
project/
└── .agents/
    └── adham/
        └── .local/
```

Before creation, Adham must:

1. Explain what will be stored.
2. Add it to `.git/info/exclude` by default, not the shared `.gitignore` without permission.
3. Encrypt sensitive databases when practical.
4. Never place provider credentials there.
5. Provide **Move back to global storage** and **Delete local Adham data** actions.

Recommended local-only contents:

- Project index.
- Checkpoints.
- Temporary artifacts.
- Optional project-local memory database.
- Sandbox metadata.

Global storage remains the safer default.

# 7. Load and precedence order

Recommended order from broadest to most specific:

1. Application safety invariants.
2. Organization and workspace policies.
3. Team-workspace policies.
4. Project settings stored privately by Adham.
5. Optional `.agents/adham/` portable profile.
6. Root `AGENTS.md`.
7. Closest nested `AGENTS.md` for the target file.
8. Activated Agent Skills.
9. Agent instructions.
10. Session settings and explicit user request.

Important constraints:

- Explicit user requests cannot override hard security or administrator locks.
- A nested `AGENTS.md` scopes project instructions but cannot grant filesystem or network access.
- A skill cannot broaden its own permissions.
- Imported MCP configuration does not automatically enable tools.
- When sources conflict, Adham shows the effective rule and its origin.

# 8. Recommended project tree

```
project/
├── AGENTS.md
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
├── .editorconfig
├── .gitignore
├── .gitattributes
├── .agents/
│   ├── skills/
│   │   ├── code-review/
│   │   │   ├── SKILL.md
│   │   │   ├── scripts/
│   │   │   ├── references/
│   │   │   └── assets/
│   │   └── release-check/
│   │       └── SKILL.md
│   └── adham/                 # optional exported portable profile
│       ├── project.yaml
│       ├── agents/
│       ├── workflows/
│       ├── policies/
│       └── README.md
├── src/
├── tests/
└── ...
```

The only recommended default additions are `AGENTS.md` when requested and `.agents/skills/` when project skills exist. `.agents/adham/` is opt-in.

# 9. Future open-standard strategy

If Adham wants to help unify the ecosystem:

1. Publish the portable schema independently of the desktop application.
2. Use neutral terminology and a permissive license.
3. Provide JSON Schema or another machine-readable schema.
4. Define secure merge, inheritance, and permission semantics.
5. Create conformance tests.
6. Invite other agent projects to participate.
7. Move from `.agents/adham/` to a generic path only after shared governance and adoption exist.

Possible future standard modules:

- Project manifest.
- Agent definitions.
- Workflow and graph definitions.
- Policy manifests.
- MCP connection references without secrets.
- Memory-source declarations without private contents.

# 10. Final recommendation

For Adham v1:

- Use native OS directories globally.
- Never store secrets in project files.
- Read `AGENTS.md`, including nested files.
- Support Agent Skills and prefer `.agents/skills/`.
- Import existing MCP configurations without claiming one path is universal.
- Keep sessions, embeddings, indexes, and runtime state global by default.
- Offer opt-in portable configuration under `.agents/adham/`.
- Treat a generic `.agents/` project manifest as a future open-standard effort—not a standard that already exists.