<aside>
🐎

**Working product promise:** The only AI application you need—a private, extensible desktop workspace where people and intelligent agents work together safely.

</aside>

## Executive summary

**Adham** is an open-source, local-first AI desktop platform for individuals, developers, and—over time—professional teams and mid-sized companies. It combines an AI assistant, a user-controlled digital twin, a development team, and specialized AI employees inside one cross-platform workspace.

Unlike a conventional chatbot, Adham is designed as an **autonomous agent platform**. Its agents can reason, plan, delegate to subagents, collaborate through graphs and workflows, use memory, operate approved tools, and work across files, terminals, browsers, and desktop applications. The user controls what agents may access, which models process a task, what activity is visible, and when higher-risk actions require approval.

Adham will launch as a desktop-first product for Windows, macOS, and Linux. It will support direct connections to major AI providers, fully local offline models through Ollama, community-built skills and plugins, MCP integrations, and a future marketplace.

**Domain:** adham.si
**Initial product stage:** Planning
**Initial distribution:** Open source, global, desktop only

## Vision

Create the trusted operating environment for everyday AI: one application that can assist a person, mirror their working context as a digital twin, act as a software development team, and deploy specialized AI employees alongside human teams.

Adham should make advanced agentic systems useful without hiding their actions or forcing users to surrender sensitive data. Its long-term opportunity is to become the desktop layer through which people and organizations safely access models, agents, tools, knowledge, and automated work.

## Mission

Give every user access to capable, collaborative AI agents while keeping data, memory, permissions, and execution under human ownership.

## Product principles

1. **Local first:** User data, memory, configuration, and sensitive context remain local by default.
2. **Privacy without compromise:** Every external transfer is visible, intentional, and governed by policy.
3. **Power with boundaries:** Agents can take meaningful action, but only inside explicit, enforceable permissions.
4. **Autonomy without approval fatigue:** Routine low-risk actions proceed within policy; novel, destructive, costly, or sensitive actions escalate.
5. **Inspectability:** Users choose how much planning, reasoning summary, execution detail, and agent communication they see.
6. **Plug and play:** Models, tools, skills, plugins, MCP servers, and agents are modular rather than hard-wired.
7. **Open ecosystem:** Community contribution is a product advantage, supported by clear interfaces, testing, documentation, and governance.
8. **Reliability over performance theater:** Agents must verify their work rather than deleting content, adding nonfunctional code, or declaring success without evidence.
9. **Global by design:** English, Arabic, Simplified Chinese, and Russian are first-class product languages; Arabic is a launch priority.

## The problem

Current AI products are fragmented. Users switch between chat applications, coding agents, automation tools, local-model interfaces, plugin systems, and enterprise assistants. Agentic products often struggle with:

- Fragile loops that stall, repeat, or declare success too early.
- Weak task-state management and unreliable graph execution.
- Poor collaboration among agents and subagents.
- Tools that are selected incorrectly or receive too much context.
- Agents that modify or delete files without sufficient safeguards.
- Code changes that are reported as complete without being built, tested, or verified.
- Repeated approval requests that create human-in-the-loop fatigue.
- Opaque memory, routing, costs, permissions, and data transfer.
- Plugins, skills, and MCP servers that introduce supply-chain and execution risk.
- Cloud-first designs that require sensitive context to leave the device.

Adham addresses these problems through a coherent harness, durable task state, governed execution, verification gates, scoped memory, dynamic capability loading, and local-first privacy.

## Initial customers

### Primary launch users

- **Individuals** seeking one private AI workspace for everyday knowledge and digital work.
- **Developers** who need reliable coding agents, terminal and file tools, multi-agent workflows, and model choice.

### Expansion users

- Professional teams that want collaborative AI workspaces.
- Mid-sized technology companies deploying AI employees inside human teams.
- Organizations that need provider governance, auditability, and self-hosted models.

Adham is industry-agnostic. Its behavior is defined by the tools, skills, instructions, policies, and workspaces supplied to it. Industry-specific solutions can be delivered later as curated agent and skill packages.

## Core jobs to be done

Users should be able to ask Adham to:

- Assist with research, writing, analysis, planning, and daily work.
- Build an evolving, private digital twin from user-approved context and memory.
- Plan, implement, test, review, and document software as a coordinated development team.
- Assemble specialized AI employees that operate within defined roles and territories.
- Automate multi-step work across files, terminals, browsers, desktop applications, APIs, and connected services.
- Run sensitive work locally without sending data to a cloud model.
- Move between AI providers without rebuilding workflows.
- Install trusted capabilities without permanently bloating the agent’s context.

## Product experience

Adham presents a **desktop workspace** backed by an autonomous agent platform.

The main experience should include:

- Conversations and task workspaces.
- A visible plan, task graph, active agents, and current execution state.
- Agent creation through both a visual builder and editable configuration.
- Project workspaces with explicit folder, tool, memory, and provider boundaries.
- An activity stream showing actions, costs, policy decisions, failures, and verification results.
- Controls for pausing, resuming, editing, rerouting, retrying, or terminating work.
- Collaboration spaces where humans and agents communicate and share task state.
- Settings that range from concise results to detailed execution visibility.

### Agent organization model

Agent creation should resemble a production line: each agent has a defined role, working area, capabilities, inputs, outputs, and handoff conditions. Agents activate when work enters their territory, collaborate through an explicit graph, and cannot silently exceed their assigned permissions.

## MVP scope

The MVP must prove five foundations:

1. **Privacy-first local workspace**
2. **Reliable agentic orchestration**
3. **A provider-neutral AI harness**
4. **Durable loops and graph-based workflows**
5. **Local, user-controlled memory**

Supporting capabilities are delivered through plug-and-play modules.

### Required MVP capabilities

- Cross-platform desktop application.
- Multi-provider chat and task execution.
- Local Ollama operation without an internet connection.
- Agent and subagent creation, delegation, and collaboration.
- Persistent task state with pause, resume, retry, cancellation, and recovery.
- Graph execution with explicit nodes, transitions, budgets, timeouts, and completion conditions.
- User-approved project-folder access rather than unrestricted disk access by default.
- Sandboxed terminal, code execution, browser automation, and optional desktop control.
- Local memory with inspect, edit, export, disable, and delete controls.
- Skills, plugins, and MCP connections with permission manifests.
- Verification gates for coding and action-oriented tasks.
- English, Arabic, Simplified Chinese, and Russian interfaces.
- Optional, minimal telemetry that can be fully disabled.

### Not in the initial release

- Mobile applications.
- A mandatory Adham account or sign-in.
- A required Adham cloud backend.
- Bundled paid inference as the primary model.
- Claims of completed SOC 2, ISO 27001, or HIPAA certification before formal assessment.

## AI providers and modalities

Adham will begin with **bring your own API key** and a consistent provider abstraction. Planned support includes:

- Anthropic
- OpenAI
- Google Gemini
- DeepSeek
- GLM
- xAI Grok
- OpenRouter as a multi-model gateway
- Ollama Cloud
- Ollama Local
- Company-hosted and self-hosted open-source models

The architecture should support text, image, audio, vision, document, and video-capable models as provider capabilities mature.

Users select default models and may assign models by agent, skill, modality, privacy class, budget, or task. Automatic routing can be added behind transparent policies. If a provider is unavailable or a budget is exhausted, Adham must stop the affected task safely, preserve its state, explain the failure, and allow an approved retry or provider change. It must not silently spend more or switch data boundaries.

A future low-cost Adham subscription can package managed inference after the project earns sufficient reputation and usage.

## Agent harness, loops, and graphs

The harness is the control layer between models and real-world actions. It owns:

- Model and provider adapters.
- Context assembly and compression.
- Tool discovery and routing.
- Permissions and policy enforcement.
- Task state, checkpoints, budgets, and cancellation.
- Memory retrieval and writes.
- Agent and subagent lifecycle.
- Structured outputs and handoffs.
- Tracing, evaluation, and recovery.

### Reliability contract

An agent may not mark a task complete solely because it generated an answer or changed files. Completion conditions should be explicit and machine-checkable where possible.

For software work, completion can require relevant combinations of:

- Build success.
- Type checking and linting.
- Unit, integration, and end-to-end tests.
- A review agent or deterministic diff check.
- Confirmation that requested features are reachable and functional.
- Preservation checks that detect unexpected deletion or scope expansion.
- A final evidence summary linking claims to outputs.

Loops require maximum iterations, time and cost budgets, progress detection, retry policies, and safe termination. Graph nodes require typed inputs and outputs, idempotency where possible, durable checkpoints, and visible failure states.

## Human control without approval fatigue

Adham should use **risk-adaptive approval**, not an approval dialog every few seconds.

- **Allow automatically:** Read-only actions and reversible work inside an approved workspace and budget.
- **Allow by standing policy:** Repeated actions that match a user-defined rule.
- **Ask once per task or session:** New capabilities whose risk is understood and bounded.
- **Always ask:** Destructive file operations, access outside approved folders, credential use, external publishing, purchases, messages, privilege changes, or sensitive-data transfer.
- **Block by default:** Attempts that violate an administrator policy or cannot be contained safely.

NVIDIA OpenShell provides a useful architectural reference: agents run in isolated sandboxes, file/system/network access is enforced by policy, credentials are injected only for approved endpoints, and risky policy expansions can be escalated for review rather than allowing an agent to approve itself.[[1]](https://github.com/NVIDIA/OpenShell)

Adham should study and integrate compatible open-source components where they fit, but retain its own user-facing policy model and avoid depending on a single vendor-specific runtime.

## Privacy, memory, and governance

### Data policy

- Sensitive user data remains local by default with no exceptions silently introduced by product features.
- Memory is local by default.
- Cloud model use requires a visible provider and data-boundary decision.
- Prompts, outputs, files, and memory are not retained by Adham cloud because no required cloud backend exists initially.
- Users can inspect, edit, export, disable, and permanently delete memories.
- Secrets are stored in the operating system’s secure credential facility or an encrypted local vault, never inside prompts or plugin configuration files.

### Telemetry

Telemetry is limited to what is necessary to improve stability and product quality. It must exclude prompts, user content, credentials, file paths, memory contents, and private project identifiers. It is transparent, optional, and completely disableable. Published aggregate telemetry reports should be considered to strengthen community trust.

### Enterprise roadmap

Future team and enterprise editions should add:

- Roles and policy administration.
- Audit logs and retention controls.
- Data-loss prevention.
- Provider and model restrictions.
- Workspace-level routing and budget policies.
- Self-hosted inference and internal registries.
- SSO and SCIM when accounts and managed workspaces are introduced.

Adham should design for GDPR readiness and maintain a roadmap toward SOC 2 and ISO 27001. HIPAA support should be treated as a separate regulated deployment profile with legal and technical validation—not a general marketing claim.

## Sandboxing and filesystem access

Agents should receive access only to the folder, project, application, or resource explicitly opened by the user. Whole-disk access—including unrestricted access to a Windows system drive—must not be the default.

Recommended execution model:

- One isolated sandbox per task, project, or agent risk boundary.
- Read/write mounts limited to approved workspace folders.
- Read-only mounts where modification is unnecessary.
- Ephemeral scratch storage for generated code and downloads.
- Explicit outbound network rules.
- Brokered credentials that agents cannot read directly.
- Resource limits for CPU, memory, storage, processes, time, and cost.
- Snapshots or change sets for review and rollback.

OpenSandbox is a relevant reference for isolated command execution, managed files, browser and desktop environments, outbound network policies, credential vaulting, and a path from local Docker execution to Kubernetes.[[2]](https://github.com/opensandbox-group/OpenSandbox)

## Skills, plugins, MCP, and marketplace

### Capability model

- **Tools** perform specific read or action operations.
- **MCP servers** expose external tools and resources through a standard connection layer.
- **Skills** teach agents how to complete a class of work and may package scripts and supporting resources.
- **Plugins** extend the desktop application, runtime, interface, or integrations.
- **Agents** combine instructions, models, tools, skills, memory, policies, and a working territory.

Notion and email could initially be delivered through MCP tool connections rather than full desktop plugins. A plugin is justified when deeper user interface, offline behavior, event handling, or application-level integration is required.

### Preventing routing and context failures

Adham should not load every installed capability into every prompt. Large tool schemas and irrelevant instructions create context bloat, higher cost, slower execution, and weaker tool choice.[[3]](https://glama.ai/blog/2025-12-16-what-is-context-bloat-in-mcp)

Recommended controls:

- Maintain a searchable capability registry with names, descriptions, tags, permissions, cost, compatibility, and quality signals.
- Retrieve a small candidate set for each task.
- Load the full skill or tool schema only after routing.
- Prefer one primary skill per task phase, with explicit transitions for multi-skill work.
- Record routing confidence and allow correction.
- Test skills against representative tasks before publication.
- Measure success, failures, latency, cost, and policy denials per capability.

### Marketplace trust model

The marketplace may include free and paid agents, skills, and plugins—including expert packages maintained by language or framework communities. Revenue can later include marketplace commissions.

Every package should include:

- A signed publisher identity and immutable version.
- A permissions manifest.
- Declared network destinations and data access.
- Compatibility and dependency information.
- Automated malware, secret, and prompt-injection scanning.
- Skill-specific security analysis and dangerous-instruction detection.
- Test results and quality metadata.
- Clear trust tiers: unverified, community verified, Adham reviewed, and organization approved.
- Revocation, quarantine, rollback, and incident reporting.

Public MCP servers and agent skills must be treated as supply-chain inputs rather than trusted instructions; least privilege, isolation, source review, and behavior monitoring are required.[[4]](https://obot.ai/resources/learning-center/mcp-security)

## Technical direction

### Desktop stack

- **Core/backend:** Rust
- **Frontend:** Strict TypeScript
- **Build tooling:** Vite
- **Data fetching and state synchronization:** TanStack Query
- **Routing:** TanStack Router
- **Styling:** Tailwind CSS v4

The exact desktop shell remains a technical decision. The preferred option should minimize attack surface and bundle size while providing strong Rust integration, secure IPC, code signing, automatic updates, accessibility, and dependable support for Windows, macOS, and Linux.

### Platform support

- Windows 10 and Windows 11, x64 only for the initial release.
- Broad macOS support, with an explicit minimum supported version selected before beta and a documented best-effort policy for older releases.
- Major 64-bit Linux distributions, with packaging and support tiers defined before beta.

Promising support for every historical macOS or Linux version would be operationally unsafe; Adham should publish and test a clear compatibility matrix instead.

### Recommended security baseline

- Memory-safe Rust core and minimal native privileges.
- Strict desktop content security policy and isolated renderer processes.
- Typed, allowlisted IPC commands.
- Dependency and license scanning.
- Reproducible builds and signed releases.
- Software bill of materials.
- Secret scanning and secure credential storage.
- Automatic security updates with rollback.
- Fuzzing for parsers and policy boundaries.
- Threat modeling and community vulnerability reporting.

A paid penetration-testing program is not required for the first prototype. Before a stable release that handles sensitive company data, independent security review should become a funding priority.

## Open-source strategy

Adham will be developed openly so contributors can improve the harness, providers, tools, skills, language support, security, and platform integrations.

The project should establish:

- A clearly selected open-source license.
- Public governance and contribution guidelines.
- A code of conduct and security policy.
- Signed commits or contributor attestation.
- Architecture decision records.
- Required tests and review for sensitive components.
- Maintainer ownership for core, security, providers, desktop, localization, and ecosystem packages.
- A stable extension SDK that prevents plugins from depending on private internals.

The final license and any future open-core boundaries remain open decisions.

## Business model

### Phase 1: Adoption

- Free open-source desktop application.
- Bring-your-own provider keys.
- Free local Ollama support.
- Community-built tools, skills, and plugins.

### Phase 2: Sustainable services

- Low-cost managed inference subscription.
- Optional model bundles and intelligent routing.
- Paid marketplace items with commission revenue.
- Team collaboration and governance features.

### Phase 3: Company platform

- Enterprise workspace management.
- Self-hosted and private-cloud deployment.
- Support, security, and compliance packages.
- Curated AI employee and industry capability packs.

Pricing, sponsor benefits, and financial targets will be defined after the MVP scope and delivery plan are validated.

## Brand direction

**Official name:** Adham
**Working promise:** The only AI app you need
**Identity:** A powerful black Arabian horse with vivid blue eyes
**Primary product palette:** Neutral light and dark interfaces
**Brand/action color:** `#2B2BFF`, reserved primarily for actions and distinctive brand moments

The horse identity should communicate intelligence, power, speed, discipline, independence, and trust—not aggression for its own sake. A scalable SVG mark and accessible light/dark variants are required.

## Success measures

The first release succeeds when users can:

- Complete real work across multiple steps without losing task state.
- Run a fully local, offline AI workflow.
- Understand which model, agent, tool, and policy is active.
- Restrict agents to approved files, applications, networks, and budgets.
- Recover from model, tool, or process failures without restarting the project.
- Verify software changes through builds and tests before completion.
- Install a capability without exposing unrelated data or permanently inflating context.
- Delete memory and confirm that it is gone.

Product metrics should initially focus on task completion with verification, recovery rate, unsafe-action prevention, routing accuracy, approval frequency, cost per completed task, crash-free sessions, and active open-source contributors.

## Delivery phases

### Phase 0 — Architecture and proof of safety

- Desktop shell decision.
- Provider abstraction.
- Local Ollama prototype.
- Rust policy and execution core.
- Project-scoped filesystem access.
- Sandboxed terminal and basic agent loop.

### Phase 1 — Developer alpha

- Task graphs and checkpoints.
- Subagents and role-based handoffs.
- Code verification gates.
- Skills and MCP registry.
- English and Arabic interfaces.

### Phase 2 — Public beta

- Windows, macOS, and Linux packaging.
- Visual agent builder.
- Browser and optional desktop tools.
- Simplified Chinese and Russian interfaces.
- Marketplace foundations and trust metadata.

### Phase 3 — Teams

- Collaborative workspaces and agent communication.
- Policy administration, audit logs, and budgets.
- Managed inference and subscription options.
- Self-hosted company models.

Dates will be set after architecture validation and contributor capacity are known.

## Key risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Scope is too broad for an initial team | Protect the five MVP foundations and move integrations into modules |
| Agent actions damage user work | Sandboxes, scoped mounts, snapshots, policy checks, and reversible changes |
| Approval fatigue blocks autonomy | Risk-adaptive policies and standing approvals with hard safety boundaries |
| Agents report false completion | Machine-checkable completion gates and evidence-based summaries |
| Plugin or MCP supply-chain compromise | Signing, scanning, trust tiers, permissions, isolation, and revocation |
| Too many tools reduce model quality | Dynamic discovery and just-in-time context loading |
| Cross-platform maintenance becomes expensive | Compatibility matrix, shared Rust core, automated platform testing |
| Privacy promise conflicts with cloud models | Visible data-boundary labels and local-model defaults for sensitive work |
| Open-source activity does not fund development | Managed inference, marketplace, team features, sponsorships, and support |

## Sponsorship proposition

Adham is suitable for sponsors that support open-source AI, privacy infrastructure, developer tooling, local inference, multilingual technology, cybersecurity, or cross-platform applications.

Potential sponsorship can fund:

- Core engineering and platform testing.
- Security review and threat modeling.
- Multilingual localization.
- Open-source model hosting and inference credits.
- Build infrastructure and signed releases.
- Community programs, documentation, and marketplace review.

Sponsor participation must not grant access to user data or weaken provider neutrality, local-first privacy, open governance, or product independence. Sponsor packages, funding targets, deliverables, and recognition will be documented separately when outreach begins.

## Open decisions

- Desktop shell and sandbox implementation strategy.
- Open-source license and any future commercial boundary.
- Exact minimum macOS and supported Linux versions.
- Memory storage format, encryption, and migration approach.
- Extension SDK and package-signing model.
- Initial marketplace review process.
- MVP dates, staffing plan, and required funding.
- Sponsor packages and governance protections.
- Legal interpretation and implementation plan for GDPR, SOC 2, ISO 27001, and HIPAA-related deployments.