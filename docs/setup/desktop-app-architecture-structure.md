# Desktop Application Full Architectural Structure & Specifications

This document defines the authoritative frontend directory and module structure for `apps/desktop/src/` in accordance with Adham's DDD modular monolith principles, Feature-Sliced Design (FSD) conventions (§6 of `Engineering — Initial repository architecture-and-setup instructions.md`), and strict separation of concerns.

---

## 1. Core Architectural Principles

1. **No Logic in the Navigation Rail**:
   - The Navigation Rail (`widgets/shell/nav-rail/`) is strictly a high-level shell component (40px icon strip).
   - It only renders shell triggers (such as `<WorkspaceSwitcherTrigger />` at the top and settings at the bottom).
   - It **never** contains workspace data management, workspace creation logic, or entity files.

2. **Strict Layer Separation (Feature-Sliced Design)**:
   - `entities/`: Domain models, database schemas, TanStack Query hooks, and persistent stores.
   - `features/`: User-driven capabilities and interactive actions (e.g. creating a workspace, switching projects).
   - `widgets/`: Compositional UI surfaces and dialogs (e.g. Onboarding wizard, Workspace manager modal, Session timeline).
   - `shared/`: Low-level, domain-agnostic infrastructure (API client, modular i18n, design tokens, UI primitives).

3. **First-Class Arabic & Internationalization**:
   - Dedicated language definitions (`languages.ts`) with explicit text direction (`ltr` / `rtl`).
   - Modular locale message catalogs in `locales/{en,ar,zh-CN,ru}/messages.json`.
   - Automatic document-level direction synchronization (`dir="rtl"` for Arabic, `dir="ltr"` for Latin scripts).

---

## 2. Directory Tree for `apps/desktop/src/`

```text
apps/desktop/src/
├── app/                                # Application bootstrap & root wrappers
│   ├── bootstrap/                      # Hydration & first-run onboarding check
│   ├── providers/                      # React Query, Theme, I18n providers
│   ├── router/                         # TanStack Router instance & route tree
│   └── styles/                         # Global styling tokens & resets
│
├── routes/                             # TanStack Router route endpoints
│   ├── __root.tsx                      # Root shell & modal mount root
│   ├── index.tsx                       # Main workspace & active session route
│   ├── onboarding.tsx                  # Dedicated first-run onboarding route
│   └── gallery.tsx                     # Component design system gallery
│
├── widgets/                            # Composite UI regions & major dialogs
│   ├── shell/                          # Desktop shell layout system
│   │   ├── nav-rail/                   # 40px icon rail (triggers only)
│   │   ├── primary-sidebar/            # Workspace session list & search
│   │   ├── secondary-sidebar/          # Agent / tool sidebars
│   │   ├── context/                    # Central canvas housing timeline & compose
│   │   ├── panel/                      # Right inspector (Plan, Graph, Artifacts)
│   │   └── titlebar/                   # Window drag region & layout toggles
│   │
│   ├── compose/                        # Prompt composer widget
│   │   ├── composer.tsx                # Main unified composer
│   │   ├── compose-input.tsx           # Textarea with auto-resizing & RTL
│   │   ├── compose-model-picker.tsx    # Model selector with boundary badge
│   │   ├── compose-status-strip.tsx    # Scope folder, policy, token budget
│   │   └── compose-approval-bar.tsx    # Docked inline tool approval
│   │
│   ├── session/                        # Session timeline & message stream
│   │   ├── session-timeline.tsx        # Message thread & turn progression
│   │   ├── message-turn.tsx            # User/Assistant/System message cards
│   │   ├── tool-execution-card.tsx     # Tool calls with inline output & verification
│   │   └── session-empty-state.tsx     # Centered welcome logo state
│   │
│   ├── workspace/                      # Workspace management dialogs
│   │   ├── workspace-manager-modal.tsx # Workspace list, switcher, delete & edit
│   │   └── workspace-settings-view.tsx # Bound directory path & security settings
│   │
│   └── onboarding/                     # First-run onboarding wizard
│       ├── onboarding-wizard.tsx       # 8-step full-window setup flow
│       ├── onboarding-step-header.tsx  # Step indicator & title
│       └── onboarding-navigation.tsx   # Back / Next / Finish controls
│
├── features/                           # Interactive user actions & flows
│   ├── workspace/
│   │   ├── workspace-switcher/         # Popover dropdown triggered from Nav Rail
│   │   ├── create-workspace/           # Folder picker dialog + initial config
│   │   └── manage-workspace/           # Delete workspace confirmation, rename
│   │
│   ├── project/
│   │   ├── project-selector/           # Switch active project inside sidebar
│   │   └── create-project/             # Add project modal/dialog
│   │
│   ├── session/
│   │   ├── session-search/             # Search sessions by title & content
│   │   ├── session-fork/               # Fork session from previous turn
│   │   └── session-delete/             # Delete session confirmation
│   │
│   ├── onboarding/
│   │   ├── step-language/              # Step 1: Language selection (EN / AR) & RTL
│   │   ├── step-model-detect/          # Step 2: Detect Ollama & local models
│   │   ├── step-workspace-path/        # Step 3: Pick local workspace root directory
│   │   ├── step-isolation/             # Step 4: Sandboxing & permission policies
│   │   ├── step-fallbacks/             # Step 5: Cloud fallback options (optional)
│   │   ├── step-telemetry/             # Step 6: Telemetry privacy confirmation
│   │   └── step-ready/                 # Step 7: Final summary & launch
│   │
│   └── compose-message/                # Submitting prompts & attaching context
│
├── entities/                           # Domain entities, stores & TanStack Queries
│   ├── workspace/
│   │   ├── types.ts                    # Workspace domain interfaces
│   │   ├── queries.ts                  # useWorkspaces(), useActiveWorkspace()
│   │   ├── store.ts                    # useWorkspaceStore (active workspace ID)
│   │   └── ui/                         # WorkspaceAvatar, WorkspaceBadge
│   │
│   ├── project/
│   │   ├── types.ts                    # Project domain interfaces
│   │   ├── queries.ts                  # useProjects(workspaceId)
│   │   ├── store.ts                    # useProjectStore (active project ID)
│   │   └── ui/                         # ProjectTag, ProjectStatus
│   │
│   ├── session/
│   │   ├── types.ts                    # Session domain interfaces
│   │   ├── queries.ts                  # useSessions(projectId), useSessionTimeline()
│   │   ├── store.ts                    # useSessionStore (active session ID)
│   │   └── ui/                         # SessionListItem, SessionTimestamp
│   │
│   ├── agent/
│   │   ├── types.ts                    # Agent descriptors & roles
│   │   └── queries.ts                  # useAgents()
│   │
│   └── model/
│       ├── types.ts                    # Model capabilities & boundary types
│       └── queries.ts                  # useAvailableModels(), useOllamaStatus()
│
└── shared/                             # Universal shared utilities
    ├── api/                            # Typed Tauri IPC client (adhamClient)
    ├── i18n/                           # Modular internationalization
    │   ├── index.ts                    # i18n instance & direction sync
    │   ├── languages.ts                # Supported languages, codes & LTR/RTL metadata
    │   └── locales/
    │       ├── en/messages.json        # English translation catalog
    │       ├── ar/messages.json        # Arabic translation catalog (RTL)
    │       ├── zh-CN/messages.json     # Chinese translation catalog
    │       └── ru/messages.json        # Russian translation catalog
    ├── hooks/                          # Reusable UI hooks (useRTL, useHotkeys)
    └── theme/                          # Dark / Light theme provider
```

---

## 3. Placement Breakdown for Requested Concepts

| Concept | Layer | Specific Directory | Role & Responsibilities |
| :--- | :--- | :--- | :--- |
| **Onboarding** | Route & Widget | `routes/onboarding.tsx`<br>`widgets/onboarding/`<br>`features/onboarding/` | First-run 8-step wizard shown on fresh install before entering the main shell. Handles language/RTL, Ollama detection, workspace directory selection, sandboxing, and telemetry. |
| **Workspace Management** | Entity, Feature, Widget | `entities/workspace/`<br>`features/workspace/`<br>`widgets/workspace/` | - `entities/workspace/`: Stores active workspace ID, queries Tauri for workspaces.<br>- `features/workspace/workspace-switcher/`: Popover triggered from the rail icon.<br>- `widgets/workspace/workspace-manager-modal.tsx`: Comprehensive modal to add/edit/remove workspaces. |
| **Project Management** | Entity & Feature | `entities/project/`<br>`features/project/` | - `entities/project/`: Projects belonging to the active workspace.<br>- `features/project/project-selector/`: Rendered in `widgets/shell/primary-sidebar/` to switch between projects. |
| **Session Management** | Entity, Feature, Widget | `entities/session/`<br>`features/session/`<br>`widgets/session/` | - `entities/session/`: Active session state, timeline turns, and event projections.<br>- `widgets/shell/primary-sidebar/`: History of recent sessions.<br>- `widgets/session/`: Central message timeline rendered inside `<Context>`. |

---

## 4. Internationalization (i18n) Architecture

The i18n subsystem has been refactored out of the monolithic single file into clean, modular catalogs:

1. **`languages.ts`**:
   - Single source of truth for language codes (`en`, `ar`, `zh-CN`, `ru`).
   - Declares native names and text directions (`dir: 'ltr' | 'rtl'`).
   - Exports helper functions: `getLanguageDirection(lang)` and `isRTL(lang)`.

2. **`locales/{lang}/messages.json`**:
   - Discrete, clean JSON message files for English, Arabic, Chinese, and Russian.
   - Organized by functional scopes (`welcome`, `compose`, `status`, `rail`, `sidebar`, `contextPanel`, `settings`, `gallery`).

3. **`index.ts`**:
   - Assembles the resource bundles.
   - Initializes `i18next` with `fallbackLng: 'en'`.
   - Listens to `languageChanged` and updates `document.documentElement.dir` (`rtl` vs `ltr`) and `document.documentElement.lang`.
