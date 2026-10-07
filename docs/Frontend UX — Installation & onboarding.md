<aside>
🖥️

This specification defines Adham’s first-run experience: native installation, mandatory workspace and project setup, provider connection, privacy boundaries, and the transition into the desktop workspace.

</aside>

## Design recommendation

Adham should combine two proven ideas and improve them for a local-first agent platform:

- From Notion: a **workspace** is the stable top-level home for people, permissions, settings, and shared content, while access is managed at increasingly specific levels.[[1]](https://www.notion.com/help/intro-to-workspaces)
- From DeepSeek Harness: an agent cannot work safely until a **workspace directory** is selected; its composer remains unavailable until that boundary exists. Model providers are configured separately and can take effect without restarting.[[2]](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/guide/index.md)

Adham’s enhanced model is:

> **Workspace = people, policies, providers, memory rules, and shared capabilities.**
**Project = a bounded working environment containing approved files, agents, sessions, tools, and task history.**
> 

Every installation must create or join a workspace and create or open at least one project. This prevents the unsafe pattern of launching an autonomous agent before defining where it may work.

## Experience goals

- Installation feels native on every operating system.
- A first-time user reaches a useful workspace in under five minutes.
- Privacy choices are understandable without security expertise.
- No agent receives whole-disk access by default.
- Advanced configuration is available without blocking beginners.
- The same mental model works for an individual, a developer, and a future company team.
- Arabic and right-to-left layout are first-class from the first screen.

# 1. Installation experience

## macOS

### Primary distribution

Use a signed and Apple-notarized `.dmg`.

### User flow

1. User downloads **Adham for macOS** from `adham.si` or the GitHub Releases page.
2. User double-clicks `Adham.dmg`.
3. The disk image opens with:
    - Adham application icon on the left.
    - Applications folder shortcut on the right.
    - A clear arrow and the instruction **Drag Adham to Applications**.
4. User drags Adham into Applications.
5. User ejects the disk image and opens Adham from Applications, Spotlight, or Launchpad.
6. macOS verifies the notarized application.
7. Adham displays its own welcome screen.

### Design details

- Use a neutral background, a subtle black-horse illustration, and `#2B2BFF` only for the arrow, focus state, and key instruction.
- The DMG must not include unrelated files or a complicated installer.
- Offer separate Apple Silicon and Intel downloads initially only if a universal build is impractical.
- On first launch, request permissions only when their associated feature is used. Do not request Files, Accessibility, Screen Recording, or Automation permissions as one large bundle.

### Permission timing

- **Project folder:** Requested when the user selects or creates a project.
- **Accessibility/Desktop control:** Requested when desktop control is enabled.
- **Screen Recording:** Requested before vision-based desktop observation.
- **Microphone:** Requested before voice input.
- **Notifications:** Requested after the user starts a long-running task, not during the welcome screen.

## Windows

### Primary distribution

Use a signed x64 installer such as `.exe` or `.msi`, with an uncomplicated wizard.

### User flow

1. User downloads **Adham for Windows**.
2. User double-clicks the installer.
3. Windows displays the verified publisher.
4. Installer opens on one primary setup screen:
    - Install location, collapsed under **Options**.
    - **Create desktop shortcut**, optional and checked by default only if user research supports it.
    - **Launch Adham after installation**, checked by default.
5. User selects **Install**.
6. Progress is shown without marketing slides.
7. Completion screen offers **Open Adham**.
8. Adham launches into onboarding.

### Recommendation

Avoid unnecessary **Next → Next → Next** screens. Keep the familiar installer behavior, but compress default installation into a single meaningful confirmation followed by progress and completion.

### Windows requirements

- Windows 10 and 11, x64.
- Authenticode-signed installer and application binaries.
- Per-user installation by default so administrator privileges are not unnecessarily required.
- Clear handling for SmartScreen reputation during early open-source releases.
- Add Start menu and uninstall entries automatically.

## Linux

### Recommended primary experience

Provide a verified terminal installer that detects the distribution, installs the correct signed package, registers the desktop entry, and makes Adham available from the application launcher.

```bash
curl -fsSL https://adham.si/install.sh | sh
```

For security-conscious users, the website must also document a download-first and verify flow rather than requiring a pipe directly into the shell.

### Installer behavior

1. Detect CPU architecture and supported distribution.
2. Display exactly what will be installed and where.
3. Verify package signature and checksum.
4. Prefer a native `.deb` or `.rpm` package when supported.
5. Use an AppImage or equivalent portable build as a fallback.
6. Install the desktop entry, application icon, MIME/URL handlers if used, and command-line launcher.
7. Print **Adham installed successfully** and the command `adham`.
8. Make Adham discoverable in the application menu for normal double-click launching.

### Required alternatives

- `.deb` for Debian and Ubuntu families.
- `.rpm` for Fedora, RHEL-compatible, and openSUSE families.
- AppImage as a broad portable fallback.
- Published checksums, signatures, and reproducible-build information.

### Update behavior

Adham should show available updates but never silently replace security-sensitive runtime components while agents are executing. Updates should be signed, resumable, and reversible when practical.

# 2. Mandatory onboarding architecture

## Core object model

### Workspace

A workspace is the durable top-level boundary for:

- Human members and future team roles.
- Global privacy and approval policies.
- Model providers and credential references.
- Installed plugins, skills, MCP servers, and agents.
- Memory defaults and retention rules.
- Budgets, telemetry, language, appearance, and updates.
- Multiple projects.

### Project

A project is the execution boundary for:

- One or more explicitly approved folders.
- Project instructions and context.
- Sessions, tasks, plans, graphs, and checkpoints.
- Project-specific agents and AI employees.
- Tool, network, model, and cost permissions.
- Project memory and knowledge.
- Activity history and change review.

### Session

A session is one durable stream of work inside a project. It inherits workspace and project policies but may narrow them. It may not silently broaden access.

## Why this is better

Notion demonstrates that users understand a workspace as the shared home that contains people, settings, and content, with more specific permissions below it.[[1]](https://www.notion.com/help/intro-to-workspaces) DeepSeek Harness correctly blocks the composer until a working directory has been selected, ensuring tools operate inside a defined filesystem location.[[2]](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/guide/index.md)

Adham improves the pattern by separating:

- **Organizational boundary:** Workspace.
- **Execution and filesystem boundary:** Project.
- **Temporary work boundary:** Session or task.

This makes the model suitable for one person today and collaborative AI employees later without weakening local-first privacy.

# 3. First-launch onboarding flow

Use a focused full-window wizard. Keep the main sidebar hidden until setup is complete. Show progress as meaningful labels rather than `Step 2 of 8` alone.

## Screen 1 — Welcome

### Purpose

Explain the promise before asking for configuration.

### Content

- Adham horse mark.
- Heading: **Your AI. Your machine. Your rules.**
- Supporting text: **Build a private workspace for assistants, agents, and AI teams. Your files and memory stay local unless you explicitly choose a cloud provider.**
- Primary action: **Set up Adham**
- Secondary action: **Restore existing setup**
- Links: Privacy principles, open-source repository, release notes.

Do not show account creation. Adham does not require sign-in for the initial product.

## Screen 2 — Language and appearance

### Fields

- Language: English, العربية, 简体中文, Русский.
- Appearance: System, Light, Dark.
- Text size: Default with accessibility shortcut.

### Behavior

- Apply changes immediately.
- When Arabic is selected, mirror the entire wizard into a tested RTL layout rather than only translating text.
- Remember the choice locally.

## Screen 3 — Create the workspace

### Default path

Most first-time users select **Personal workspace**.

### Options

- **Personal workspace** — Local workspace for one person.
- **Team workspace** — Prepare shared roles and policies; collaboration services may be enabled later.
- **Join workspace** — Disabled or marked **Coming later** until secure team identity exists. Do not present a nonfunctional path as available.

### Required fields

- Workspace name, prefilled as **My workspace**.
- Optional icon or initials.
- Local data location, shown under **Advanced**.

### Privacy preset

- **Private local** — Local models preferred; cloud transfer always shown.
- **Balanced** — Cloud models allowed by project policy; risky actions require approval.
- **Custom** — Opens the full policy matrix.

Recommended default: **Private local**.

### Microcopy

> A workspace contains your projects, agents, providers, skills, and privacy rules. You can create more workspaces later.
> 

## Screen 4 — Create or open the first project

This is mandatory. The user cannot enter an empty global chat with unrestricted tools.

### Choices

- **Open a folder** — Recommended for developers and existing work.
- **Create a project folder** — Creates a new empty folder at a chosen location.
- **Start without files** — Creates a project with an isolated Adham-owned storage area.
- **Try a safe demo** — Creates disposable sample content and uses no personal files.

### Required fields

- Project name, inferred from the selected folder when possible.
- Approved folder list.
- Project purpose: General assistant, Digital twin, Software development, AI team, or Custom.

### Filesystem consent panel

Before confirming, show:

- **Can access:** Exact selected folders.
- **Cannot access:** Other home folders, system folders, external drives, and credentials unless later approved.
- Access mode: Read and write, Read only, or Custom.
- Toggle: **Review file changes before applying**, on by default.

### Repository detection

If Adham detects Git, package manifests, language files, or project instructions, summarize them after selection. Do not scan outside the approved folder.

## Screen 5 — Choose intelligence

Adham should configure providers after the workspace and project boundary are understood.

### Provider cards

- **Ollama Local** — Private and offline. Detect automatically.
- Anthropic
- OpenAI
- Google Gemini
- DeepSeek
- GLM
- xAI Grok
- OpenRouter
- Custom or company endpoint

### Interaction

- Place **Ollama Local** first when available.
- Each cloud card states: **Your request and selected context will be sent to this provider.**
- API keys use password-style fields, are write-only after saving, and are stored in the operating system credential vault or encrypted local store.
- Include **Test connection** before saving.
- Fetch models when supported; allow manual model IDs when discovery fails.
- Provider changes take effect immediately without application restart.

DeepSeek Harness offers a useful pattern: provider credentials are write-only after saving, the interface returns a redacted descriptor rather than the secret, custom OpenAI- or Anthropic-compatible endpoints can be added, and provider changes apply on the next request.[[3]](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/guide/providers.md)

### No-provider state

Allow the user to finish structural setup without a provider, but clearly disable task submission and show **Connect a model to start**. This is better than preventing access to settings, logs, and local project configuration.

## Screen 6 — Set autonomy

Do not reduce this decision to a vague toggle.

### Presets

#### Safe

- Read approved project files automatically.
- Ask before writes, commands, network access, delegation, or external actions.

#### Balanced — Recommended

- Read and reversible edits inside the project automatically.
- Run known development commands inside the sandbox.
- Ask before destructive, external, credentialed, costly, or scope-expanding actions.

#### Autonomous

- Proceed within explicit project policies and budgets.
- Continue to block forbidden resources and escalate high-risk policy changes.

### Advanced policy preview

Show a compact matrix for:

- File reads.
- File writes and deletes.
- Terminal commands.
- Network destinations.
- Browser control.
- Desktop control.
- Credentials.
- Agent delegation.
- External messages and publishing.
- Spending and token budget.

A preset only initializes the matrix; the underlying policy remains inspectable and editable.

## Screen 7 — Choose the starting team

Offer editable templates instead of forcing users to understand agent architecture immediately.

- **Assistant** — One general agent.
- **Digital twin** — Assistant plus user-controlled memory and personal context rules.
- **Development team** — Planner, implementer, tester, reviewer, and documentation agent.
- **AI employees** — Role-based agents with an explicit task board, territories, and handoffs.
- **Start minimal** — No optional agents; build later.

Each template shows what it installs, which tools it can request, and how many agents may run concurrently.

Recommended default for developers: **Development team**.
Recommended default for general users: **Assistant**.

## Screen 8 — System check and launch

Display a final readiness checklist:

- Workspace created.
- Project boundary configured.
- Local storage writable.
- Sandbox runtime available.
- Provider connected or setup deferred.
- Default model selected.
- Autonomy policy active.
- Language and theme configured.

### Primary action

**Open Adham**

### First task suggestions

Suggestions should match project purpose and use only approved capabilities, for example:

- **Explain this project without changing files.**
- **Check the repository and propose a development plan.**
- **Create my private assistant profile.**
- **Show what Adham can access.**

# 4. Main application after onboarding

## Sidebar hierarchy

1. Workspace switcher.
2. Search or command launcher.
3. Projects.
4. Current project navigation:
    - Home
    - Sessions
    - Tasks and graph
    - Agents
    - Memory
    - Files
    - Activity
5. Shared capability navigation:
    - Skills
    - Plugins
    - MCP and integrations
    - Marketplace
6. Settings and privacy status.

## Top bar

- Current workspace and project breadcrumb.
- Active model and provider.
- Local/cloud data-boundary indicator.
- Current autonomy mode.
- Running-agent indicator.
- Global pause/stop control when work is active.

## Empty project home

The first project home should contain:

- A primary task composer.
- **What Adham can access** card.
- Connected model status.
- Installed starting team.
- Recent activity.
- Suggested safe first tasks.

The composer is enabled only when a project exists and a usable model is selected. File and action tools remain governed by the project boundary.

# 5. Critical states and errors

## Folder moved or unavailable

- Preserve the project and its history.
- Disable file tools.
- Show **Reconnect folder**.
- Never silently substitute another folder.

## Provider unavailable

- Stop the affected task safely.
- Preserve checkpoint and task state.
- Explain the provider error.
- Offer **Retry**, **Choose another model**, or **End task**.
- Never silently route private data to a different provider.

## Sandbox unavailable

- Keep chat and read-only planning available when safe.
- Disable execution tools.
- Provide a repair action and diagnostic details.

## Permission denied

Explain:

- Which agent requested access.
- The exact resource or action.
- Why it is needed.
- Duration: once, task, project, or always.
- Risk and reversibility.

## Onboarding interrupted

Save after every completed screen. Relaunch at the last valid step. Provide **Start over** under a secondary menu without deleting existing project files.

# 6. Visual and interaction direction

- Neutral light and dark surfaces.
- Use `#2B2BFF` for primary actions, active focus, selected navigation, and essential status—not large decorative areas.
- Black horse identity appears strongly on welcome and about screens, then becomes subtle inside the productivity interface.
- Prefer compact desktop density with generous spacing around high-risk confirmations.
- Motion communicates state changes and agent activity; respect reduced-motion settings.
- Always pair status color with text or icons.
- Meet WCAG 2.2 AA contrast and keyboard navigation expectations.
- Ensure every onboarding action is reachable without a mouse.
- Design RTL and long translations at component level from the start.

# 7. Product decisions

## Recommended now

- Mandatory workspace and project creation.
- No mandatory account.
- Local-first personal workspace by default.
- Folder-scoped project permissions.
- Provider setup during onboarding, but deferable.
- Balanced risk-adaptive autonomy as the default.
- Development-team and assistant templates.
- Native installers plus signed Linux packages and terminal installation.

## Decide before implementation

- Desktop shell and native permission APIs.
- Exact macOS minimum version.
- Linux package signing and repository strategy.
- Workspace/project local storage format.
- Whether `.adham/` project metadata is stored inside the project or in Adham’s application data.
- Exact sandbox dependency and fallback behavior.
- How future team workspaces synchronize without weakening local-first guarantees.

# 8. Acceptance criteria

- A new user can install and open Adham through the standard pattern for their operating system.
- First launch never requires account creation.
- Onboarding cannot complete without a workspace and a project.
- No project receives full-disk access by default.
- The user sees exact folder and provider data boundaries before the first task.
- A local Ollama user can complete onboarding and run offline.
- A cloud-provider user can test and save a key without the key being shown again.
- The user can choose Safe, Balanced, or Autonomous behavior and inspect the resulting policy.
- Arabic onboarding works correctly in RTL.
- Onboarding resumes safely after interruption.
- The first project opens with a relevant, safe task suggestion and visible privacy status.