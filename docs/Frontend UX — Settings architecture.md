<aside>
⚙️

Adham Settings uses a large modal with searchable navigation, explicit configuration scope, secure credentials, inherited organizational policies, and detailed controls for models, agents, memory, extensions, privacy, and routing.

</aside>

## Confirmed direction

- Settings opens as a **large modal overlay** without navigating away from the active workspace.
- The Settings entry lives in the footer of the primary sidebar or navigation rail.
- A **Search settings** field sits at the top-left above the settings navigation, following the supplied Notion reference.
- The initial settings groups are comprehensive and may be reorganized as the product matures.
- Advanced actions are available but must not make the default experience difficult for ordinary users.

# 1. Modal structure

## Container

- Large centered modal on standard desktop displays.
- Near-full-window layout when space is limited.
- Dim the application behind it while preserving the user’s place.
- Close from the top-right or with `Esc` when no unsaved security-sensitive change is pending.
- Remember the most recently opened settings page during the current app session.

## Left settings sidebar

1. **Search settings**.
2. Current configuration scope.
3. Grouped settings navigation.
4. Fixed footer for Help, Diagnostics, version information, and Advanced settings.

Search must find individual controls, models, providers, agents, tools, permissions, and pages—not only section names. Each result shows its section and current scope.

## Main content pane

- Page title and concise explanation.
- Current scope and inheritance status.
- Clearly separated setting sections.
- Controls aligned consistently on the trailing edge.
- Sticky **Review changes** bar for provider, permission, policy, routing, or agent changes.

Harmless preferences such as theme apply immediately. Security-sensitive changes require review and explicit saving.

# 2. Settings navigation

## Personal and application

- General
- Appearance & language
- Keyboard shortcuts
- Updates
- Telemetry

## Organization and work

- Workspaces & projects
- People & organization
- Privacy & data
- Memory & knowledge
- Policies & autonomy
- Tools & permissions

## Intelligence

- Models & providers
- Routing & fallbacks
- Agents

## Extensions

- Skills
- Plugins
- MCP & integrations
- Marketplace

## System

- Storage & backup
- Security
- Diagnostics
- Advanced

Skills, Plugins, and MCP remain separate pages inside one **Extensions** group because their execution models, risks, and configuration differ.

# 3. Configuration scopes

Adham should use five scopes with explicit inheritance.

## Application

Applies to the local installation and operating-system user:

- Theme, language, density, and accessibility.
- Global shortcuts.
- Startup and update behavior.
- Telemetry consent.
- Encrypted provider credential vault.
- Runtime and sandbox configuration.

## Organization workspace

Represents the top-level company or personal workspace:

- Members and organization structure.
- Company privacy and retention policy.
- Approved providers, models, extensions, and tools.
- Authoritative knowledge sources.
- Global budgets and routing rules.
- Executive agents and reporting rules.

## Team workspace

Represents a department such as Engineering, Product, Security, or Finance:

- Team managers and shared agents.
- Shared knowledge and capabilities.
- Team budgets and provider restrictions.
- Department-owned projects.
- Reporting relationships to the organization level.

## Project

Represents a bounded execution environment:

- Approved folders and repositories.
- Project instructions and sources.
- Assigned agents and tools.
- Default and fallback models.
- Project memory.
- Filesystem, network, execution, and cost policies.

## Agent

Defines a reusable worker or manager:

- Role and instructions.
- Assigned projects or workspaces.
- Models, tools, skills, and memory.
- Delegation and reporting rights.
- Budget, runtime, verification, and approval rules.

## Session or task

Provides temporary choices without rewriting durable configuration:

- Model selected in the composer.
- Temporary budget or visibility changes.
- One-time tool grants.

A lower scope may always become more restrictive. It may broaden an inherited restriction only through the required approval flow.

# 4. Inheritance and locking

Recommended hierarchy:

```
Application
└── Organization workspace
    └── Team workspace
        └── Project
            └── Agent
                └── Session or task
```

Every inheritable setting displays its origin:

- **Set here**
- **Inherited from organization**
- **Inherited from team workspace**
- **Inherited from project**
- **Temporarily overridden**
- **Locked by administrator**

An overridden control offers **Reset to inherited value**.

Administrators may lock privacy, data, provider, extension, knowledge, budget, model, memory, and security rules. Lower levels cannot bypass locks.

<aside>
🔐

Organizational rank and reporting do not automatically grant data access. An executive agent may receive approved reports without being allowed to open every underlying project file.

</aside>

# 5. Company structure and agent organigram

Adham supports a company-like hierarchy:

- **Company workspace:** CEO, CTO, board, and executive coordination agents.
- **Department workspaces:** Engineering, Product, Security, Operations, and others.
- **Projects:** Explicit work boundaries owned by one or more departments.
- **Project agents:** Specialists limited to relevant tasks and project territory.
- **Manager agents:** Coordinate projects and receive structured reports.
- **Executive agents:** Analyze approved reports and issue governed instructions.

Each agent has:

- Organizational position.
- Reporting manager.
- Direct reports or delegated subagents.
- Assigned workspaces and projects.
- Data-access territory.
- Tools and skills.
- Input and output contracts.
- Escalation and approval rules.

An agent assigned to several projects receives each project as a separate execution context. It must never carry active paths, task state, hidden prompts, memories, or tool state from Project A into Project B.

## Required isolation model

- Every request carries immutable workspace, project, agent, and session identifiers.
- Tool registries and filesystem roots are built for that exact context.
- Context caches are keyed by full context identity—not only provider or model.
- Background workers stay visibly attached to their original project.
- Switching projects does not retarget running agents.
- Cross-project communication occurs only through an explicit handoff or approved report.

# 6. Knowledge and source-of-truth settings

Knowledge sources have authority and mutability levels.

## Locked authoritative

For private identity facts, company policy, legal rules, approved architecture, and other information agents must not change.

- Read-only to agents.
- Editable only by authorized humans.
- Versioned and auditable.
- Available to RAG or vector retrieval.
- Retrieval includes source, version, and authority level.
- Agents may propose changes but cannot apply them.

## Managed editable

For maintained documentation and shared company knowledge.

- Editable by authorized people and approved agents.
- Changes follow the source’s review policy.
- Version history and rollback are mandatory.

## Working or generated

For drafts, plans, summaries, temporary notes, and agent-produced memory.

- Modifiable within project policy.
- Lower authority than locked sources.
- Cannot silently overwrite authoritative facts.

If sources conflict, Adham surfaces the conflict and prefers the current highest-authority source instead of blending incompatible claims.

# 7. Providers, credentials, and model isolation

## Global credential vault

Provider credentials are stored at application scope using the operating system’s secure credential store or a strongly encrypted local vault.

Credentials must never appear in:

- Project files.
- Model prompts or context.
- Session logs.
- Agent-visible environment dumps.
- Plugin or MCP configuration exports.

The provider adapter retrieves the secret and injects it only into the authorized outbound request. The model never receives the API key itself.

## Workspace grants

Credentials are global by default but are not automatically available everywhere. A user grants selected workspaces access to a named provider account.

Allow several accounts for the same provider when isolation, billing, or company ownership requires it. Require clear aliases such as:

- `OpenAI — Personal`
- `OpenAI — Company production`
- `Anthropic — Development`

Warn about accidental duplicates without forbidding legitimate separation.

# 8. Default models, fallback chains, and routing

Each workspace supports:

- One default model.
- An ordered fallback chain.
- Models assigned to specific task categories.
- Optional project and agent overrides.

The composer always shows the active model. The user may select another model for the current session, make it the project default, or return to the inherited choice.

## Automatic fallback

Fallback may activate for:

- Provider outage.
- Rate limits.
- Unsupported modality or required capability.
- Context-window limits.
- Budget restrictions.
- Latency or quality policy.

A fallback must never silently move work from a local model to a cloud provider. Crossing a privacy boundary requires explicit approval or a previously defined rule naming the permitted provider and data class.

## Routing inputs

- Task type.
- Required capabilities and modality.
- Privacy classification.
- Model quality.
- Speed and availability.
- Context window.
- Cost and budget.
- Workspace, project, and agent policy.

## Task-specific models

Support separate choices for:

- General chat.
- Planning.
- Coding.
- Vision and documents.
- Image generation.
- Video generation.
- Embeddings and retrieval.
- Memory summarization.
- Review and verification.
- Security analysis.

## Cost controls

Budgets can be defined by provider, workspace, project, agent, day, and month. Show estimated cost before expensive tasks and live cost during execution when provider data makes this possible.

# 9. Agent settings

Each agent page includes:

- Identity, role, description, and organizational position.
- Instructions and locked instruction sections.
- Default model and fallback policy.
- Assigned workspaces and projects.
- Tools, skills, plugins, and MCP access.
- Memory read and write permissions.
- Filesystem and network territory.
- Delegation and reporting relationships.
- Budget, runtime, concurrency, and retry limits.
- Approval and verification policy.
- Versions, evaluations, activity, and rollback.

Agents can be cloned, exported, imported, published, disabled, archived, versioned, and restored.

Agents cannot install or activate capabilities independently. They may submit a request explaining the capability, permissions, and reason. A human or authorized governing agent reviews the request according to policy.

# 10. Skills, plugins, MCP, and marketplace

Every installed capability displays:

- Publisher and signature status.
- Version and update availability.
- Trust level.
- Requested permissions.
- Filesystem and network access.
- Workspaces, projects, and agents using it.
- Last activity.
- Health and error state.

## Updates

- Show an available update rather than applying it silently.
- **Update** performs a one-click installation.
- Restart only when required and never during active agent work.
- Any update requesting new permissions pauses for approval.

Unsigned community capabilities may be installed after a strong warning, permission review, and trust confirmation.

## MCP connection methods

Support modern connection patterns:

- Local `stdio` process.
- Remote HTTPS.
- OAuth.
- Bearer token.
- Custom headers and environment references where necessary.

MCP servers begin with individual tools disabled. Users enable only the required tools and assign each one a policy:

- Read-only.
- Ask before write or side effect.
- Allow automatically inside policy.
- Blocked.

Each MCP server shows health checks, latency, errors, recent actions, authentication state, and exposed tools.

# 11. Policies and autonomy

Offer both:

- **Safe, Balanced, and Autonomous** presets.
- A detailed permission matrix.

Policies cover:

- Files and folders.
- Terminal commands.
- Network destinations.
- Browser and desktop control.
- Credentials.
- External messages and publishing.
- Purchases and spending.
- Agent delegation.
- Memory writes.
- Model and provider routing.

Users can create named policies such as **Coding**, **Research**, **Private offline**, and **Company restricted**.

## Policy simulator

Allow users to ask:

> Would Agent X be allowed to perform Action Y in Project Z?
> 

The result explains the applicable rules, inheritance source, and expected approval behavior.

## Review inbox

Denied or escalated actions appear in a review inbox with:

- Approve once.
- Approve for this task.
- Approve for this project under stated conditions.
- Create a reusable rule.
- Reject.

This avoids asking the human about the same safe action repeatedly. The system learns only through explicit scoped rules—not by silently weakening policy.

All policy changes have history and rollback.

# 12. Memory and privacy controls

Memory is organized into:

- User memory.
- Organization memory.
- Team-workspace memory.
- Project memory.
- Agent memory.
- Session memory.

Users control which agents may read or write each category.

The Memory browser supports search, inspection, editing, pinning, export, forgetting, and permanent deletion. Sensitive-memory categories are disabled by default or require explicit enablement.

A global **Delete my data** flow previews exactly what will be removed. Routine memory actions should be governed by workspace, project, team, and agent policies so the user is not interrupted for every operation.

# 13. Telemetry

Telemetry is **off by default** and enabled only through clear consent.

Its purpose is limited to finding failures that break user work:

- Crashes.
- Performance and startup problems.
- Agent-loop or routing failures.
- Provider and extension reliability.
- Sandbox and update failures.
- Failed task recovery.

Telemetry excludes prompts, document contents, credentials, private memory, sensitive file paths, and project content.

Users can:

- Enable categories separately.
- Preview representative events and schemas.
- Inspect locally queued telemetry.
- Export or delete telemetry.
- Disable collection completely.

Adham should collect the minimum data needed to deliver a reliable experience and explain why each category exists.

# 14. Appearance, language, and accessibility

Support:

- System, Light, and Dark themes.
- User-created appearance preferences.
- Interface density.
- Text size and interface font.
- Code font.
- Sidebar width.
- Reduced motion.
- High contrast.
- Color-vision accommodations.

Appearance is personalized per user and device. Workspace branding may supply an icon and accent without overriding accessibility preferences.

Arabic becomes the default language when the operating system’s preferred language is Arabic. The application switches to a tested RTL layout while code, paths, terminal output, and technical identifiers retain appropriate direction controls.

# 15. Shortcuts and help

Shortcut details remain open, but Adham requires a complete **Help and shortcuts** page so users can perform frequent tasks without navigating the interface repeatedly.

It should include:

- Searchable command reference.
- Current shortcut for every command.
- Keyboard-only workflows.
- Command palette documentation.
- Conflict detection and reassignment.
- Platform-specific macOS, Windows, and Linux keys.
- Quick actions for pausing agents, stopping tasks, opening projects, and changing privacy mode.

# 16. Updates, diagnostics, and experiments

## Updates

- Channels: **Stable** and **Beta** only.
- Signed updates.
- One-click install.
- Clear restart requirement.
- Never restart while agents are active without confirmation.

## Diagnostics and recovery

Include:

- Configuration export and import.
- Encrypted backup.
- Factory reset.
- Diagnostics bundle.
- Application and agent-runtime logs.
- Dependency versions.
- Sandbox health.
- Credential-vault health.

Diagnostic exports automatically remove credentials, prompts, private content, sensitive paths, and user identifiers. The preview explains what remains.

## Experimental features

Experimental features require a clear warning. They remain isolated from stable workspaces unless explicitly enabled for a selected workspace or disposable test project.

# 17. Acceptance criteria

- Settings opens from the sidebar or navigation-rail footer without losing the active view.
- Search finds individual controls and reveals their scope.
- Every inherited setting shows its source and lock state.
- Lower scopes cannot bypass higher-scope security restrictions.
- Provider secrets never enter model-visible context or project files.
- Global provider accounts can be granted to selected workspaces.
- Projects using the same provider remain contextually isolated.
- The composer displays the active model and supports a session-level choice.
- Fallback never moves from local to cloud silently.
- Locked authoritative sources cannot be modified by agents.
- Organizational reporting does not imply file or memory access.
- Agents request capabilities rather than installing them.
- MCP tools are enabled individually and governed by explicit policy.
- Extension updates requesting new permissions require approval.
- Telemetry is off by default and excludes user content.
- Arabic follows system language and renders with correct RTL behavior.
- Agent and policy changes are versioned and recoverable.
- Only Stable and Beta update channels are exposed.