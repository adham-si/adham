<aside>
🧩

Adham should adopt Agent Plugins 1.0 as its portable plugin package format, then place Adham-only capabilities under the standard’s reverse-domain extension namespace instead of inventing an incompatible plugin layout.

</aside>

## Key decision

There is now a genuine open, vendor-neutral **Agent Plugins** specification. Its portable package combines Agent Skills and MCP servers using fixed, predictable locations.[[1]](https://agent-plugins.org/)

Adham should implement it as a conforming client.

# 1. Standard plugin package

The portable layout is:

```
my-plugin/
├── plugin.json
├── skills/
│   └── summarize/
│       ├── SKILL.md
│       ├── scripts/
│       ├── references/
│       └── assets/
├── mcp.json
├── si.adham.desktop/
│   ├── contributions.json
│   └── ui/
├── README.md
├── LICENSE
└── CHANGELOG.md
```

The standard defines:

- `plugin.json` at the package root.
- `skills/` containing valid Agent Skills.
- `mcp.json` containing portable MCP server definitions.
- Reverse-domain extension namespaces for client-specific capabilities.
- Package-root containment rules.
- `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` runtime locations.[[2]](https://agent-plugins.org/specification)

For Adham, the extension namespace should be:

```
si.adham.desktop
```

This follows the domain `adham.si` in reverse-domain form.

# 2. Plugin categories

## Portable capability plugin

Preferred type for most ecosystem packages.

May include:

- Agent Skills.
- MCP servers.
- Documentation and assets.

Advantages:

- Reusable across compatible clients.
- Lower coupling to Adham internals.
- Easier security review.
- Better future portability.

Examples:

- Rust development skill and tooling.
- Notion or email MCP integration.
- PDF analysis skill with a sandboxed local MCP server.
- Security-review skill bundle.

## Adham-enhanced plugin

A portable plugin with optional files or manifest data under `si.adham.desktop`.

May contribute:

- Settings pages.
- Composer actions.
- Context-panel views.
- Artifact renderers.
- Commands and shortcuts.
- Agent templates.
- Workflow templates.
- Declarative UI components.
- Adham-specific policy metadata.

Clients that do not understand the namespace ignore it while retaining the portable skills and MCP components.

## Native or high-trust plugin

Reserved for capabilities that cannot be represented safely through Skills, MCP, or declarative UI.

Examples:

- Deep operating-system integration.
- Hardware or GPU runtime adapters.
- Custom sandbox backends.
- Native model runtimes.

These require a higher trust tier, stronger signing, explicit review, and isolated execution. They should remain rare.

# 3. Manifest

Minimum portable `plugin.json`:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "Rust Engineering Toolkit"
}
```

Adham-specific data belongs only under `extensions`:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "Rust Engineering Toolkit",
  "extensions": {
    "si.adham.desktop": {
      "contributions": "./si.adham.desktop/contributions.json"
    }
  }
}
```

Do not add arbitrary Adham fields to the portable root. The standard intentionally uses a closed manifest and client namespaces to prevent collisions.[[2]](https://agent-plugins.org/specification)

# 4. MCP packaging

Portable MCP configuration belongs at:

```
mcp.json
```

It can declare:

- Local `stdio` servers.
- Streamable HTTP servers.
- Legacy HTTP+SSE where supported by the specification.

Adham maps portable MCP definitions into its internal connection and permission model.

Rules:

- Imported tools begin disabled.
- Users enable individual tools.
- Secrets are never embedded in `mcp.json`.
- OAuth, bearer tokens, and API keys are brokered by Adham’s credential vault.
- Local subprocesses run inside the plugin’s granted sandbox.
- Commands are executable tokens, not arbitrary shell command strings.
- Plugin paths cannot escape the package root.

# 5. Skills packaging

Skills live directly under:

```
skills/<skill-name>/SKILL.md
```

Each skill follows the Agent Skills specification, including progressive loading of metadata, instructions, scripts, references, and assets.[[3]](https://agentskills.io/specification)

Plugin skill identifiers should be namespaced internally to prevent collisions, for example:

```
publisher.plugin-name:skill-name
```

The user interface may display a friendly label while retaining a stable internal identity.

## Skill-name collisions and ownership

Two skills may have the same friendly name without replacing each other. Adham identifies every skill by its source and stable owner, not by the `name` field alone.

Example registry:

```
user:hero/summarize
plugin:acme.document-tools/summarize
plugin:example.research-suite/summarize
workspace:engineering/summarize
project:adham/summarize
```

The interface may display all of them as **Summarize**, but always shows a source badge such as **Mine**, **Document Tools**, **Research Suite**, **Engineering workspace**, or **This project**.

### Bundled plugin skills

A plugin’s agent, workflow, or command refers to its own bundled skill by canonical identity. Installing a personal skill with the same name does not replace or modify it.

For example:

```
plugin:acme.document-tools/summarize
```

remains the skill used by the Document Tools plugin unless the user deliberately edits that plugin configuration or creates an override.

### User-created skills

A skill created by the user receives an independent identity:

```
user:hero/summarize
```

It can be:

- Used directly through the composer or `/` command.
- Assigned to selected agents.
- Made the preferred summarization skill for a workspace or project.
- Used alongside a plugin’s summarization skill.
- Published later as its own plugin.

Plugin updates never overwrite a user-created skill.

### Routing order

When several skills match a task, Adham resolves them in this order:

1. Explicit skill selected by the user.
2. Exact skill pinned to the addressed agent or workflow.
3. Project preference for that task or intent.
4. Workspace preference.
5. Router selection using description, compatibility, trust, permissions, quality, and cost.

Adham never silently shadows one skill because another has the same short name.

### Ambiguous selection

If several equally valid skills remain and the choice materially changes the outcome, show a compact picker:

```
Choose a summarization skill
○ My Summarize — Personal
○ Summarize — Document Tools
○ Research Summarize — Research Suite
```

For low-risk cases, the router may choose automatically and expose the selected skill in the task’s capability details.

### Forking a plugin skill

Users can select **Duplicate and customize** on a bundled skill.

Adham then:

1. Copies the skill into the user or workspace scope.
2. Assigns a new canonical identity.
3. Records the original plugin skill and version as provenance.
4. Allows editing without modifying installed package files.
5. Offers a comparison when the upstream skill changes.

The fork does not receive upstream changes automatically because they could overwrite customization. The user chooses whether to merge them.

### Disable and uninstall behavior

- Disabling a plugin disables its bundled skills unless a workflow is already safely completing under policy.
- Uninstalling a plugin removes its bundled skills from availability.
- User-created skills and forks remain untouched.
- Agents that depended on a removed skill become **Needs configuration** rather than silently switching to another same-named skill.

# 6. Installation locations

Plugin packages are installed globally into Adham’s application-data directory, not copied into every project.

Conceptual layout:

```
<ADHAM_DATA>/plugins/
├── packages/
│   └── <publisher>/<plugin>/<version>/
├── data/
│   └── <installation-id>/
├── staging/
└── quarantine/
```

The exact `<ADHAM_DATA>` location follows the operating-system paths defined in Architecture — Global and project file paths.

- **Package directory:** Immutable installed files, equivalent to `PLUGIN_ROOT`.
- **Data directory:** Writable persistent data, equivalent to `PLUGIN_DATA`.
- **Staging:** Download, validation, and atomic update preparation.
- **Quarantine:** Rejected, revoked, or suspicious packages.

A plugin update replaces the immutable package version while preserving compatible plugin data.

# 7. Project assignment

Installation and availability are separate concepts.

1. Install plugin globally.
2. Grant it to selected workspaces.
3. Enable specific components for selected projects.
4. Grant tools and skills to agents.
5. Apply runtime policies per task.

A project should store only portable references when the user exports its configuration:

```
.agents/adham/plugins.yaml
```

Example intent:

```yaml
plugins:
  - id: example.rust-toolkit
    version: ">=1.2 <2"
    required: true
    components:
      skills:
        - rust-review
      mcpServers:
        - rust-analyzer
```

This file contains no binaries, secrets, tokens, private paths, or plugin runtime state.

# 8. Local plugin development

Adham may load a plugin from a local directory in **Developer mode**.

Recommended workflow:

1. Select a plugin directory.
2. Validate `plugin.json` and `mcp.json` against official schemas.
3. Validate every `SKILL.md`.
4. Display discovered components and permissions.
5. Launch inside an isolated development profile.
6. Reload explicitly or through an opt-in file watcher.
7. Show logs and validation failures in a Plugin Developer panel.

Developer plugins remain visibly marked and disabled in stable company workspaces unless an administrator approves them.

# 9. UI contributions

Prefer declarative contributions over arbitrary frontend code.

`si.adham.desktop/contributions.json` may declare:

- Commands.
- Settings groups and fields.
- Composer actions.
- Context-panel tabs.
- Artifact renderers.
- Agent and workflow templates.
- Menus and command-palette entries.
- File or MIME associations.

Adham renders these using its own trusted UI components.

## Sandboxed custom UI

When declarative UI is insufficient, custom views run in a restricted webview or isolated renderer:

- No Node.js access.
- No direct Rust-core access.
- Strict content security policy.
- No arbitrary access to the host DOM.
- Typed message bridge.
- Explicit capability grants.
- Network access controlled by policy.
- Storage limited to the plugin’s `PLUGIN_DATA`.

A plugin cannot inject code into the main Adham interface or access another plugin’s state.

# 10. Runtime isolation

Do not run third-party plugins inside the trusted Rust core or main frontend process.

Recommended runtime options:

- MCP subprocess inside an OpenShell/OpenSandbox-style boundary.
- WebAssembly component for deterministic local extensions.
- Separate plugin-host process with a narrow IPC API.
- Sandboxed webview for custom visual surfaces.

The trusted Rust core owns:

- Permission evaluation.
- Credential brokering.
- Filesystem grants.
- Network policy.
- Process lifecycle.
- Resource budgets.
- Audit events.

# 11. Permission model

Before installation, show requested capabilities:

- Skills supplied.
- MCP servers and tools.
- Local commands or subprocesses.
- Network destinations.
- Filesystem access.
- Credential references.
- UI contributions.
- Background execution.
- Agent or workflow templates.

Permission decisions may apply to:

- Installation only.
- Workspace.
- Project.
- Agent.
- Task or session.

A plugin can request a capability but cannot grant it to itself.

# 12. Trust tiers

## Unverified

- Unsigned local or community package.
- Strong warning.
- Restricted defaults.
- No automatic updates.

## Community verified

- Stable publisher identity.
- Signature and reproducible package hash.
- Automated security checks passed.

## Adham reviewed

- Manual review of code and behavior.
- Permission and threat-model review.
- Compatibility testing.

## Organization approved

- Explicitly approved by a company administrator.
- May include internal private plugins.

Trust never replaces sandboxing or permission checks.

# 13. Installation flow

1. User opens a marketplace item or local package.
2. Adham verifies package integrity and publisher.
3. Adham validates standard manifests and contained paths.
4. Adham scans skills, scripts, binaries, dependencies, and MCP definitions.
5. Review screen shows components, permissions, trust level, and data destinations.
6. User chooses allowed workspaces.
7. Package installs into staging.
8. Adham activates permitted components atomically.
9. Installation result and audit event are recorded.

If validation fails, nothing executes.

# 14. Updates and rollback

- Updates are shown, not applied silently.
- User selects **Update**.
- New version is downloaded into staging.
- Manifest, signature, hashes, and scans are checked.
- Permission differences are displayed.
- New permissions require approval.
- Active tasks finish or pause before restart when required.
- Activation is atomic.
- Previous version remains available for rollback.
- Revoked versions move to quarantine.

# 15. Marketplace requirements

Every listing should show:

- Publisher identity.
- Trust tier.
- License.
- Supported operating systems and Adham versions.
- Portable components and Adham-specific additions.
- Requested permissions.
- Declared network destinations.
- Version history and changelog.
- Security-review status.
- Usage, ratings, and issue-reporting link.
- Free or paid status.

Paid plugins use the same package and permission model as free plugins.

# 16. Plugin versus skill versus MCP

Use a **Skill** when the extension mainly teaches an agent how to work.

Use **MCP** when it exposes external data, tools, APIs, or a sandboxed executable service.

Use an **Agent Plugin** when skills and MCP servers should be distributed as one versioned package, or when Adham-specific UI and templates are also needed.

Use a **native high-trust plugin** only when operating-system or runtime integration cannot be implemented safely through the other layers.

# 17. Acceptance criteria

- Adham validates Agent Plugins 1.0 packages.
- Portable skills and MCP servers work without requiring an Adham-only layout.
- Adham-specific components use `si.adham.desktop`.
- Package paths cannot escape the plugin root.
- Plugins receive separate persistent `PLUGIN_DATA` storage.
- Plugins install globally and are granted selectively to workspaces and projects.
- Secrets never appear in plugin packages or project references.
- Tools begin disabled until explicitly enabled.
- Third-party code does not run inside the trusted Rust core or main renderer.
- New update permissions require approval.
- Failed updates roll back safely.
- Unsigned plugins remain installable only with strong warnings and restricted defaults.
- Marketplace trust metadata is visible before installation.