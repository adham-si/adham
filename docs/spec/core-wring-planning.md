I reviewed the main 🐎adham​ and all six linked specifications. The product vision and frontend experience are strong. The main gaps are now runtime-level architecture, not more interface screens.

P0 — Core decisions required before serious implementation
1. Harness and execution state machine
This is the most important missing specification.

We need to define:

Difference between a message, turn, step, task, session, and workflow.
Agent lifecycle: created, queued, planning, running, waiting, blocked, paused, completed, failed, and canceled.
Durable event log.
Checkpoints and crash recovery.
Retry and timeout behavior.
Loop limits and progress detection.
Graph node inputs, outputs, transitions, and failure propagation.
Idempotency—preventing repeated payments, messages, file edits, or commands after retries.
How queued user instructions enter an active task.
What exactly happens when Pause, Stop, Resume, or Retry is selected.
Conditions required before an agent may report completion.
Recommended next document: Architecture — Harness, tasks, loops & durable execution

2. Agent definition and lifecycle
We designed the company organigram and user experience, but not the underlying agent contract.

We still need:

Canonical agent schema.
Agent identity and versioning.
Role, goal, instructions, and territory.
Manager and worker relationships.
Input/output and handoff contracts.
How an agent receives a context shard.
Delegation depth and concurrency limits.
Rules preventing circular delegation.
Agent mailbox and communication protocol.
Manager synthesis and verification.
When temporary subagents are destroyed or preserved.
How project isolation is technically enforced.
Agent evaluation and rollback.
3. Sandbox and capability broker
We agreed on isolation, but the exact implementation remains open.

We need to decide:

OpenShell, OpenSandbox, a custom Rust sandbox, or a layered combination.
Windows implementation where Linux container assumptions may not work.
macOS sandbox and permission behavior.
Linux namespaces, containers, or microVMs.
Project-folder mounts.
Read-only versus read/write access.
Network egress policies.
Process, CPU, memory, storage, and time limits.
Credential injection without exposing secrets.
Browser and desktop-control isolation.
Snapshot and rollback strategy.
What functionality remains available if the sandbox is unavailable.
This must connect directly to the approval and policy behavior in ⚙️Frontend UX — Settings architecture​.

4. Memory and context engine
Memory is described in the UI, but the engine has not been designed.

We need to separate:

Conversation history
Working memory
User memory
Agent memory
Project memory
Team and organization knowledge
Locked authoritative sources
Embeddings and retrieval indexes
Temporary context caches
Required decisions:

Storage engine and local vector database.
Encryption at rest.
Retrieval and ranking.
Source authority and conflict resolution.
Memory write approval.
Deduplication and outdated-memory detection.
Summarization without losing critical facts.
Provenance and citations.
Retention and deletion.
Export and migration.
Rebuilding indexes after model changes.
How private sessions guarantee no durable memory writes.
Recommended document: Architecture — Memory, context & knowledge

5. Local persistence and data model
📁Architecture — Global and project file paths​ defines where data lives, but not its structure.

We still need:

Database choice—likely SQLite for local structured state.
Event-store versus mutable-table model.
Workspace, project, session, task, agent, artifact, policy, and audit schemas.
Transaction boundaries.
Schema migrations.
Corruption detection and repair.
Concurrent access from background processes.
Backup and restore format.
Encryption keys and recovery.
Project identity when folders move or Git remotes change.
Data deletion guarantees.
6. Provider and model adapter contract
We listed providers and routing behavior, but every provider must fit one internal contract.

Define:

Text and multimodal requests.
Streaming events.
Tool calls and structured output.
Reasoning controls.
Context and output limits.
Usage and cost reporting.
Cancellation.
Timeouts and retries.
Provider-specific errors.
Rate limits.
Model discovery.
Capability detection.
Compatibility overrides.
Fallback eligibility.
Local versus cloud data classification.
This is necessary before the composer’s model picker can work reliably.

7. Policy engine
The UX is specified, but the authorization algorithm is not.

We need a deterministic policy model answering:

May this agent perform this action on this resource, in this project, using this credential, at this cost, right now?

Define:

Subjects: users, agents, plugins, skills, and MCP servers.
Resources: files, tools, credentials, models, networks, memories, and artifacts.
Actions: read, write, delete, execute, transmit, delegate, and publish.
Scope inheritance.
Deny-versus-allow precedence.
Administrator locks.
Temporary grants and expiration.
Risk classification.
Policy simulation.
Audit evidence.
Race conditions when policy changes during execution.
8. Context and capability router
Adham’s value depends heavily on selecting the correct model, agent, skill, and tool.

We need:

Capability registry schema.
Candidate retrieval.
Skill and tool ranking.
Confidence thresholds.
Ambiguity handling.
Context-size budgeting.
Dynamic loading and unloading.
Tool-schema compression.
Router evaluation datasets.
Protection against malicious descriptions manipulating routing.
Feedback when the router chooses incorrectly.
Routing across models without breaking privacy policy.
This should incorporate the skill collision rules in 🧩Architecture — Plugin system​.

P1 — Required for a credible alpha
9. Desktop shell and process architecture
The stack is chosen, but not the desktop runtime.

Decide:

Tauri or another shell.
Rust core process.
Frontend renderer boundaries.
Background agent daemon.
Plugin-host processes.
Local HTTP/RPC versus native IPC.
Typed IPC contracts.
Crash isolation.
Deep links and protocol handlers.
Single-instance behavior.
Background execution after closing the window.
10. Browser and desktop automation
This requires its own security architecture:

DOM automation versus screenshots and vision.
Browser profiles and cookies.
Credential handling.
Downloads and uploads.
Screen capture.
Accessibility APIs.
Mouse and keyboard control.
Domain allowlists.
Protection against prompt injection from webpages.
Visible indication when an agent controls the computer.
Emergency stop.
11. Artifact system
📝Frontend UX — Markdown editor & document views​ defines Markdown well, but Adham also needs a general artifact model for:

Code
Images
Video
Audio
PDFs
Spreadsheets
HTML
Diagrams
Reports
Generated applications
Define artifact identity, versions, previews, provenance, export, checkpoints, and relationships to sessions and project files.

12. Background jobs and scheduling
We mention background work, but need:

Local background service.
Wake/sleep behavior.
Scheduling and recurring tasks.
Laptop suspend/resume.
Network-loss recovery.
Battery and resource rules.
Notification behavior.
What may run when the app window is closed.
Security behavior when the device locks.
13. Search and indexing
Adham needs one search architecture across:

Projects
Sessions
Messages
Files
Memories
Agents
Skills
Plugins
Artifacts
Activity logs
We need lexical search, semantic search, permissions filtering, indexing schedules, deletion, and local storage limits.

14. Testing and evaluation system
To prevent agents from falsely saying “done,” define:

Harness unit tests.
Deterministic execution simulations.
Agent task benchmarks.
Tool-routing evaluations.
Security and policy tests.
Context-leak tests.
Cross-project isolation tests.
Recovery and crash tests.
Golden task datasets.
Provider compatibility tests.
Regression thresholds before releases.
15. Update and supply-chain security
Installation is covered in 🖥️Frontend UX — Installation & onboarding​, but implementation needs:

Release signing.
Key storage and rotation.
Reproducible builds.
Software bill of materials.
Dependency scanning.
Delta updates.
Rollback.
Revocation.
Compromised-release response.
Plugin and application update separation.
P2 — Needed before teams and sponsors
16. Collaboration and synchronization
Team workspaces conflict with the initial “no account and no backend” approach. Before collaboration, decide:

Local-only peer-to-peer or hosted synchronization.
User and device identity.
Invitations and membership.
End-to-end encryption.
Presence and concurrent editing.
Conflict resolution.
Offline changes.
Server trust model.
Organization recovery.
Audit-log integrity.
17. Open-source license and governance
Still unresolved:

License for the application.
License for the SDK and plugin schemas.
Contributor agreement or DCO.
Maintainer and security-response structure.
Trademark policy.
Marketplace governance.
Commercial/open-core boundary.
Sponsor influence protections.
18. MVP boundary
The current vision is much larger than a normal first release. We need a strict vertical slice.

My recommended alpha:

Desktop shell
One project folder
Ollama Local plus one cloud provider
One reliable agent loop
Sandboxed files and terminal
Local sessions and checkpoints
Basic memory
AGENTS.md and Agent Skills
Plan, Execute, Stop, Retry
Build/test verification
English and Arabic foundations
Multi-agent companies, marketplace, desktop control, collaboration, video, and enterprise compliance should build on that proven core.

Recommended order
Harness, tasks, loops, and durable execution
Sandbox and capability broker
Memory, context, and knowledge
Agent definition and delegation
Provider/model adapter
Policy engine
Persistence and data model
Strict MVP architecture
The harness specification should be next. Everything already designed in ✦Frontend UX — Compose & agent workspace​ depends on it.