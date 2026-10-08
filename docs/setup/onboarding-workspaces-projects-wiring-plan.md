# Architecture & Wiring Plan: Onboarding, Workspaces, Projects & Sessions

## 1. Executive Summary & Core Object Boundaries

Adham combines local-first privacy with multi-agent governance through three strict hierarchical boundaries:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ WORKSPACE (Organizational Boundary)                                         │
│ • People & future team roles                                                │
│ • Global privacy & approval policy presets                                  │
│ • Model providers & credential vault storage                                │
│ • Installed plugins, skills, MCP servers & agent catalog                    │
│ • Memory retention, budgets, language & appearance settings                │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ PROJECT (Filesystem & Execution Security Boundary)                 │   │
│   │ • Approved filesystem directories (mandatory boundary)             │   │
│   │ • AGENTS.md instructions & project skills (.agents/skills/)         │   │
│   │ • Sandbox policies (read/write/command restrictions)                │   │
│   │ • Project memory, task graphs & checkpoint recovery                 │   │
│   │                                                                     │   │
│   │   ┌─────────────────────────────────────────────────────────────┐   │   │
│   │   │ SESSION (Temporary Work & Execution Stream)                 │   │   │
│   │   │ • Durable conversation timeline                             │   │   │
│   │   │ • Plan states, tool runs, diff reviews, approvals           │   │   │
│   │   │ • Docked Compose widget (Ask / Plan / Execute / Code)       │   │   │
│   │   └─────────────────────────────────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Onboarding (First-Run Wizard)

### Division of Responsibility
* **Backend (Rust Core)**:
  * `get_bootstrap_state`: Checks whether the local SQLite event store contains any workspace (`is_initialized: bool`, `active_workspace_id`, `active_project_id`).
  * **Environment Discovery**: Probes local runtimes (e.g. Ollama at `http://127.0.0.1:11434`, local GPU presence) and checks filesystem write permissions.
  * **Credential Storage**: Saves cloud provider API keys into OS vaults (Windows Credential Manager / DPAPI / macOS Keychain) rather than plaintext config files.
  * **Bootstrap Command**: Atomically appends initial `WorkspaceCreatedV1` and `ProjectCreatedV1` events.

* **Frontend (Desktop App)**:
  * **Route Gate**: In TanStack Router, if `bootstrap.is_initialized === false`, the router suspends the `<Shell>` and renders the dedicated 8-step full-window wizard:
    1. **Welcome**: Value proposition and privacy foundation.
    2. **Language & RTL**: Instant locale selection (English / العربية) with dynamic layout mirroring.
    3. **Create Workspace**: Name (*My workspace*) and privacy preset (*Private local* default).
    4. **First Project Boundary**: Mandatory folder selection via `@tauri-apps/plugin-dialog` (`open({ directory: true })`) accompanied by the **Filesystem Consent Matrix** (explicit read/write bounds).
    5. **Choose Intelligence**: Local Ollama auto-detection + optional cloud provider keys.
    6. **Autonomy Policy**: Safe vs Balanced vs Autonomous permission presets.
    7. **Starting Team**: Template selection (Development Team / Assistant / AI Employee).
    8. **System Check & Launch**: Final readiness confirmation transitioning into the desktop `<Shell>`.

---

## 3. Workspaces Management & Wiring

### Backend IPC & Event Sourcing
* **Stream ID**: `workspace:<uuid>` in canonical SQLite event log.
* **Commands**:
  * `create_workspace`: Validates protocol version and payload, assigns UUID v7, appends `WorkspaceCreatedV1`, and records execution receipt.
  * Future commands: `rename_workspace`, `archive_workspace` (events are append-only; workspaces are marked inactive rather than hard-deleted to preserve task audit histories).
* **Context Switching**: Changing the active workspace re-scopes all TanStack Query caches and updates the global `CommandContext { workspace_id, ... }`.

### Frontend Shell UI
* **Nav Rail Trigger**: The top icon on the rail (`<HugeiconsIcon icon={Briefcase08Icon} />`) serves as the **Workspace Switcher**.
* **Switcher Popover / Modal**:
  * Lists available workspaces with local/team indicators.
  * **Add Workspace** action: Prompts for workspace name, preferred language, and data folder.
  * Emits `createWorkspace` mutation via `adhamClient.createWorkspace(...)`.

---

## 4. Projects Management & Wiring

### Backend Execution Guard
* **Stream ID**: `project:<uuid>` strictly bound to parent `workspace_id`.
* **Commands**:
  * `create_project`: Requires valid `workspace_id` in context, appends `ProjectCreatedV1` with `storage_kind: "isolated" | "host"`.
* **Sandbox Enforcement**:
  * Agents and subagents are **strictly prohibited** from performing actions without an active project.
  * The tool runner validates file paths against `approved_folders`. Actions targeting external directories or sensitive OS paths are rejected by the verification gate.

### Frontend Shell UI
* **Primary Sidebar Top Section**:
  * Displays active Project name with folder icon.
  * **Project Switcher Dropdown**:
    * Lists recent projects inside the active workspace.
    * **Open Project Folder**: Invokes native OS directory dialog.
    * **Create Isolated Project**: Initializes an Adham-managed isolated sandbox.
  * Switching projects re-scopes the session timeline and resets the `<Context>` working canvas.

---

## 5. Sessions Lifecycle & Wiring

### Backend Event Sourcing & Projections
* **Stream ID**: `session:<uuid>` bound to `(workspace_id, project_id)`.
* **Commands**:
  * `create_session`: Appends `SessionCreatedV1` with optional title.
  * `submit_message`: Appends user prompt, triggers runtime scheduler, streams agent reasoning steps, tool calls, diffs, and approval events.
  * `get_conversation`: Projected query retrieving immutable session timeline items.

### Frontend `<Context>` Canvas & Compose Integration
* **Primary Sidebar Sessions Tree**:
  * Displays historical sessions filtered by search query.
  * **`+ New Session`** button initiates a fresh session stream.
* **Central `<Context>` Canvas States**:
  * **Empty State**: Centered `🐎` logo badge with centered Composer directly below it.
  * **Active Session Transition**: On first message submission, a smooth 500ms `ease-in-out` motion collapses the logo upwards and glides the Composer down to its docked bottom position.
  * **Timeline Projection**: Streams `MessageCard` items above the Composer with full RTL support and docked inline approval prompts when mutating tools are requested.
