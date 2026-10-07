<aside>
✦

The Compose page is Adham’s primary working surface: calm and minimal before a task begins, then progressively transformed into a controllable multi-agent workspace as planning and execution start.

</aside>

## Design resolution

This specification reconciles the user’s answers with Adham’s established workspace, project, privacy, routing, and agent-governance architecture.

The governing rule is **progressive disclosure**:

- A new project begins with an uncluttered centered composer.
- Sending a request creates a durable session.
- The composer moves to the bottom.
- Conversation stays readable in the center.
- Plans, graphs, agents, activity, artifacts, costs, and approvals appear only when relevant, without changing the underlying page.

# 1. Application shell

## Navigation rail

- Fixed width: `40px`.
- Positioned on the far left.
- Can collapse or reveal the primary sidebar.
- On macOS, the sidebar toggle sits in the top chrome near—but never overlapping—the native traffic-light controls.
- Windows and Linux receive an equivalent title-bar layout that respects native window behavior.
- The rail contains durable top-level destinations rather than project-specific detail.

Recommended rail destinations:

- Compose/Home
- Search
- Projects
- Agents
- Activity
- Marketplace
- Settings at the bottom

## Primary sidebar

- Default/minimum width: `247px`.
- User-resizable up to `600px`.
- Width is remembered locally.
- Serves as the routing and navigation surface imported by the current top-level destination.
- Can remain open at larger widths when the user needs project trees, long titles, task lists, or detailed filters.

For Compose, the sidebar contains:

- Workspace switcher.
- Current project.
- New compose action.
- Sessions and tasks.
- Pinned items.
- Recent projects.
- Search and filters.

## Central workspace

The center holds the greeting, composer, conversation, plans, completion cards, and inline status events.

It has two states:

1. **Empty compose state:** centered and calm.
2. **Active session state:** conversation timeline with composer docked at the bottom.

## Context panel

An optional right panel handles contextual content without replacing the conversation.

Tabs include:

- Activity
- Plan
- Task graph
- Agents
- Context
- Files changed
- Artifacts
- Cost and usage

The panel may be resized, collapsed, or opened by selecting relevant inline items.

## Focus mode

A single action hides the navigation rail, primary sidebar, and right context panel. It preserves only the central working context and composer. Pressing the shortcut or moving to the edge reveals a temporary navigation affordance.

# 2. Entry behavior

## New project

Show:

- A simple professional greeting.
- Project name and privacy status.
- Centered composer.
- Recent projects below the fold or in the primary sidebar.
- A small set of project-aware suggestions.

Avoid a large marketing dashboard, capability catalog, or decorative cards.

## Existing project

Use adaptive restoration:

1. If a task is actively running, reopen that task.
2. If work was interrupted or waiting for approval, reopen the actionable session.
3. Otherwise, reopen the most recent session.
4. If the project has no sessions, show the empty compose state.

This preserves continuity without forcing every project into a dashboard.

# 3. Unified composer modes

Use one composer rather than separate Chat and Task products.

Available modes:

- Ask
- Plan
- Execute
- Code
- Research
- Create
- Automate
- Custom

The selected mode can configure agents, models, tools, skills, visibility, and policies. Adham may infer a mode and show a lightweight suggestion such as **Detected: Software development task**. The user can accept, dismiss, or change it.

Modes can change during a session. Changes affect the next queued instruction and do not silently rewrite already-running steps.

## Plan first

Every execution-capable mode offers **Plan first**. When enabled:

1. Adham creates a plan without performing side effects.
2. The user edits steps, assignments, budgets, and constraints.
3. Execution begins only after approval.

# 4. Empty composer

## Greeting

Use a concise professional greeting, for example:

**What would you like to work on?**

Do not add a long product explanation once onboarding is complete.

## Composer anatomy

### Upper row

- Active agent or manager chip.
- Optional task title when inferred.
- Selected project context.

### Input area

- Multiline, automatically expanding text field.
- `Enter` sends.
- `Shift + Enter` inserts a line break.
- Input behavior remains configurable in Settings.

### Leading controls

- Add/attachment button.
- Voice or audio input.
- Optional screen capture.

### Lower control row

- Active mode.
- Model or routing picker.
- Local/cloud privacy indicator.
- Context button.
- Capability overflow.
- Estimated tokens and cost when available.
- Send button.

## Input types

Support:

- Text and code.
- Images and screenshots.
- Documents.
- Audio.
- Video.
- Individual files.
- Folders.
- Clipboard content.
- Voice dictation.

Users may drag files anywhere over the central workspace. A clear drop target appears without disrupting the current draft.

# 5. Attachment scope and privacy

When a file is added, assign one of three scopes:

- **Use once:** Available only to the next request and discarded according to local retention settings.
- **This session:** Available throughout the current session.
- **Project knowledge:** Added to project context under the project’s memory and indexing policy.

The default depends on source and task, but remains visible on each attachment chip.

Before cloud submission, Adham checks whether attached or pasted content may be sensitive. A warning identifies the destination provider and the selected context. The user may remove content, use a local model, or continue under policy.

Estimated tokens and cost are shown when reliable. The feature may be removed or simplified if development proves estimates misleading.

# 6. Model and routing picker

Use the supplied visual reference as direction: the model picker is compact, searchable, and opens directly from the composer.

## Placement

- Actionable picker inside the composer.
- Compact active-model and provider status in the page header.
- Fallback details in a popover rather than permanent composer clutter.

## Picker content

Each model row can show:

- Model and provider.
- Provider-account alias.
- Local or cloud status.
- Speed and cost class.
- Context capacity.
- Supported modalities.
- Availability.

## Choices

- A specific model.
- **Auto route**.
- A saved routing profile.
- Optional multi-model execution when the selected mode supports comparison or review.

After choosing a model, the user can apply it to:

- This message.
- This session.
- This project.
- Future sessions through the inherited default.

## Fallback event

Automatic fallback creates a visible timeline event:

> Default model unavailable. Switched to the approved fallback according to the project policy.
> 

It shows both models and the reason. A fallback never crosses from local to cloud silently.

# 7. Agents, teams, and company delegation

## Addressing agents

Typing `@` opens agents, humans, teams, projects, files, folders, memories, and knowledge sources. Search results are grouped by type.

An agent result shows:

- Name and role.
- Organizational position.
- Current availability.
- Active model.
- Main capabilities.
- Project territory.
- Trust or policy status.

## Default recipient

The recipient follows the configured organigram.

Example:

- The user addresses the CTO agent.
- The CTO recognizes that the request belongs to a software project.
- The CTO delegates to the responsible engineering manager.
- The manager creates work for relevant project agents.
- Workers report to the manager.
- The manager verifies and reports to the CTO.
- The CTO returns the final result to the user.

Users do not need to address the development team manually when the organizational route already defines responsibility.

## Direct addressing

The user may still address:

- One specialist.
- A project manager.
- A predefined agent team.
- The full project team.
- A human and agent together.

## Swarm behavior

Adham should learn from Kimi Agent Swarm’s orchestrator pattern: a primary agent decides when work benefits from parallel subagents, each subagent receives a focused context shard, and only useful conclusions return to the manager rather than flooding the shared context.[[1]](https://www.kimi.com/en/help/agent/agent-swarm)

Adham enhances this with explicit company roles, project isolation, budgets, permissions, verification, and user control. Parallelism is used only when independent work reduces critical-path time or improves coverage—not to inflate agent counts.

Open-source Agent Swarm offers an additional reference for lead/worker delegation, isolated workers, persistent memory, durable task state, and review gates.[[2]](https://github.com/desplega-ai/agent-swarm)

# 8. Agent communication surfaces

No single visualization is sufficient for every user. Adham provides synchronized views over the same durable task state:

- **Timeline:** Chronological events and decisions.
- **Threads:** Direct discussion with one agent or human.
- **Task board:** Assignments, ownership, dependencies, and status.
- **Graph:** Delegation, execution, and handoff relationships.
- **Manager summary:** Compressed status for users who trust the team.

The default is a concise conversation plus manager summaries. Users can increase visibility through Settings or per session.

A user may stop or redirect one subagent without stopping unrelated work. The initial global **Stop** action ends the entire task, with a secondary menu for selected agent or current step control.

# 9. Commands, mentions, and capabilities

## Slash commands

Typing `/` opens:

- Commands.
- Modes.
- Skills.
- Workflows.
- Templates.
- Common task actions.

## Mentions

Typing `@` opens:

- Agents and agent teams.
- Humans.
- Files and folders.
- Projects.
- Memories.
- Knowledge sources.

## Add capability

When the active target is a general model rather than a predefined agent, the composer allows temporary selection of tools, skills, plugins, MCP tools, and knowledge sources.

A predefined agent already brings its configured capability set. The user can narrow that set or add a temporary capability if policy allows.

Selected capabilities appear as removable chips. Adham does not add extra explanations for every automatic selection unless the user opens details or a policy requires disclosure.

If a disabled capability is needed:

1. Adham requests permission to enable it.
2. If denied, the task remains alive.
3. The agent continues with permitted capabilities when a valid alternative exists.
4. If completion is impossible, it returns a clear blocked result explaining what was missing.

# 10. Context control

The compose header and Context panel expose:

- Active workspace and project.
- Approved folders.
- Selected files and attachments.
- Knowledge sources.
- Memory scopes.
- Git branch and working tree when relevant.
- Active environment or sandbox.
- Current agent and model.

The **Context** button shows everything the next request may access.

Users can add context with `@file`, `@folder`, `@memory`, `@project`, and `@source`.

Adham warns when context becomes excessive and offers:

- Remove irrelevant sources.
- Summarize selected content.
- Split the work.
- Delegate independent context to subagents.

## Private session

A visible **Private session** control disables durable memory writes for that session. Users may also decide whether the current output can be written to memory.

Authoritative retrieved knowledge appears with visible source citations and authority indicators.

# 11. Conversation timeline

The center remains optimized for human-readable conversation. The right panel holds detailed operations.

Important events also appear inline:

- Model and provider changes.
- Agent delegation and handoffs.
- Tool calls.
- File changes.
- Terminal commands.
- Permission decisions.
- Costs and budget warnings.
- Errors and retries.
- Checkpoints.
- Verification results.

Detailed tool calls are collapsed by default. Users can inspect commands, arguments, results, duration, and policy decisions.

## Reasoning visibility

Default: **Short reasoning summary**.

Settings can choose:

- Hidden.
- Short summary.
- Detailed execution explanation.

Adham should expose useful plans, evidence, and decisions without claiming to reveal private hidden model reasoning.

# 12. Branching and editing

Users can:

- Reply to an earlier message.
- Create a new branch from a turn boundary.
- Edit and resend an earlier prompt.
- Preserve the original session as history.

Default behavior:

- Editing an earlier prompt creates a branch.
- Existing agent actions are not undone automatically.
- The branch clearly states which state and files it inherited.
- A branch that needs a clean environment may start from an earlier checkpoint.

# 13. Plans, graphs, and progress

The right panel always offers plan and graph views; simple tasks may leave them empty or minimal rather than hiding the feature entirely.

Users choose a default planning view in Settings:

- Checklist.
- Kanban board.
- Graph.
- Timeline.
- Automatic based on task complexity.

Users can add, remove, reorder, assign, pause, retry, or edit steps.

Each step displays:

- Owner.
- Status.
- Dependencies.
- Model and capabilities.
- Cost and elapsed time.
- Inputs and outputs.
- Verification result.

Progress percentages appear only for measurable work. Open-ended reasoning uses states and completed milestones rather than fabricated percentages.

# 14. Approvals and governance

Approval requests appear consistently in:

- Conversation timeline.
- Right activity panel.
- Global review inbox.
- Desktop notification when appropriate.

The initial approval card prioritizes:

- Requesting agent.
- Exact requested action.

Expandable details include target files, destination, reason, risk, reversibility, cost, and consequences of denial.

Actions:

- Allow once.
- Allow for this task.
- Allow for this project under stated conditions.
- Create a reusable policy.
- Edit the requested action.
- Deny.

Destructive operations require a preview or diff.

Adham does not hide distinct risky requests inside an opaque group. Trusted repetitive actions should instead be covered by scoped policies. When visually grouped for convenience, every underlying request remains individually inspectable.

# 15. Artifacts, files, and code

Generated documents, code, images, reports, and other outputs open in the right artifact/editor panel, with compact preview cards in the conversation.

Code and file changes support:

- Diff before application.
- Accept or reject by file.
- Accept or reject individual changes.
- Restore checkpoint.
- Undo the full task when reversible.
- Open in VS Code, Cursor, Finder, Explorer, or terminal.

A coding completion card reports:

- Build result.
- Tests.
- Type checks.
- Linting.
- Review result.
- Files changed.
- Remaining warnings or unverified behavior.

Incomplete or unverified work is never labeled complete.

# 16. Running-task controls

Persistent running controls include:

- Pause.
- Resume.
- Stop.
- Add instruction.
- Reduce budget.
- Change priority.
- Change model for future steps.
- Reassign work.

New instructions are queued and shown visibly rather than being injected unpredictably into an active model call.

Running status includes:

- Current operation.
- Active agents.
- Elapsed time.
- Tokens and cost.
- Used and remaining budget.
- Current step and checkpoint.

Closing the window may allow an explicitly eligible local task to continue in the background. The user receives a clear choice: **Keep running**, **Pause**, or **Stop**. Background work remains visible through system status and on reopening Adham.

# 17. Session history and search

Sessions support:

- Pin.
- Rename.
- Archive.
- Duplicate.
- Export.
- Delete.
- Bookmark important messages or outputs.

Statuses:

- Draft
- Planning
- Running
- Waiting
- Blocked
- Completed
- Failed
- Canceled

Adham generates titles and summaries, both editable by the user.

## Simple search

One search field finds session titles, summaries, messages, agents, files, and artifacts.

## Detailed filters

- Project.
- Date.
- Agent.
- Human participant.
- Task status.
- Model/provider.
- Tag or folder.
- Contains files or artifacts.
- Cost range.

# 18. Collaboration

Team workspaces support:

- Human and agent mentions.
- Task assignment.
- Comments on outputs.
- Shared approval review.
- Watching live work.
- Taking control of a task.
- Presence and concurrent plan editing.

The composer clearly indicates whether a message is addressed to a human, an agent, or both. The timeline records who approved, changed, stopped, reassigned, or rerouted work.

Collaborative plan edits use presence indicators, conflict handling, and durable revision history.

# 19. Empty, blocked, and failure states

## No model

Keep the composer visible but disabled with:

**Connect a model to start**

The action opens the relevant Settings modal page.

## Project folder unavailable

Conversation and history remain available. File and execution tools are disabled until the folder is reconnected.

## Tool unavailable

Continue with allowed capabilities when possible. Otherwise return a blocked result without destroying task state.

## Task failure

Primary recovery action: **Retry from checkpoint**.

Secondary actions:

- Choose another approved model.
- Choose another agent.
- Repair the missing configuration.
- Export diagnostics.
- End the task.

# 20. Responsive desktop behavior

As width decreases:

1. Context panel collapses first.
2. Primary sidebar overlays rather than compressing the conversation below its usable width.
3. Navigation rail remains accessible.
4. Composer controls move into an overflow menu.
5. Active model, privacy boundary, and Stop remain visible.

At large widths, sidebar, center, and context panel may coexist.

# 21. Acceptance criteria

- A new project opens with a calm centered composer.
- Sending the first request moves the composer to the bottom without navigating to another product surface.
- Navigation rail is `40px`; primary sidebar begins at `247px` and resizes to `600px`.
- Focus mode leaves only the central context and composer.
- The active workspace, project, model, provider boundary, and autonomy policy remain discoverable.
- Model choice can apply to one message, session, project, or inherited future default.
- The active manager delegates according to the configured organigram.
- Parallel agents receive isolated context and report concise results to their manager.
- `@` mentions agents, humans, files, projects, memories, and sources.
- `/` opens commands, modes, skills, workflows, and templates.
- Disabled capabilities do not automatically kill a task.
- Users can inspect all context available to the next request.
- Conversation remains readable while detailed execution stays in the right panel.
- All meaningful model, agent, tool, file, approval, cost, failure, checkpoint, and verification events are auditable.
- Destructive changes require a preview.
- Unverified work is never reported as complete.
- New instructions are queued during execution.
- Eligible work can continue in the background only with an explicit choice.
- Failure recovery starts with retrying from the latest safe checkpoint.
- Project context never leaks into another project or agent execution boundary.