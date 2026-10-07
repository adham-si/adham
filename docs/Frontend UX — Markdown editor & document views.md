<aside>
📝

Adham keeps Markdown as the portable source of truth while offering polished Reader, Visual Edit, Markdown Source, and Split Preview views. HTML is generated safely for rendering and export—not maintained as a second competing document.

</aside>

## Core recommendation

Do not make users choose permanently between a Markdown file and an HTML file.

Use one canonical `.md` document and provide several synchronized views:

1. **Reader** — Clean themed document.
2. **Visual Edit** — Rich editable document without visible Markdown syntax.
3. **Markdown** — Full source editor.
4. **Split** — Markdown and live rendered preview side by side.
5. **HTML** — Optional generated-source inspection and export for advanced users.

Markdown Live Preview demonstrates the useful baseline of source editing, synchronized preview, theme switching, opening files, and export.[[1]](https://markdownlivepreview.com/) Adham should preserve that simplicity while adding a real visual editor, document themes, safe HTML rendering, project context, and artifact integration.

# 1. One source of truth

The `.md` file remains canonical.

```
notes.md
```

Adham parses it into an internal Markdown abstract syntax tree, renders that tree into a themed document, and serializes visual edits back into Markdown.

Do not maintain this by default:

```
notes.md
notes.html
```

Two independently editable files will drift, create merge conflicts, and leave agents unsure which version is authoritative.

HTML is instead:

- A live rendering.
- A cached preview.
- An explicit export.
- An optional artifact for publishing.

# 2. View switcher

Place a compact segmented control in the document header:

```
Reader | Visual | Markdown | Split
```

Put **HTML source** and export actions under the overflow menu because most users do not need them.

Remember the user’s preferred view:

- Per file during the current session.
- Optionally per file type or project.
- Never alter the underlying file simply because the view changed.

## Reader view

Purpose: focused reading and presentation.

- Fully rendered typography.
- No editor chrome inside the document body.
- Optional table of contents.
- Heading anchors.
- Code highlighting and copy controls.
- Rendered tables, task lists, callouts, diagrams, math, images, and links.
- Theme and width controls.
- Print and export.

Double-clicking or pressing `Enter` on a block can move into Visual Edit at that location.

## Visual Edit view

Purpose: edit a polished document directly.

- Rich-text selection and formatting toolbar.
- Slash commands for blocks.
- Markdown shortcuts such as `#` , `-` , and triple backticks.
- Drag-and-drop block reordering where the format supports it safely.
- Inline links, images, tables, tasks, code blocks, callouts, and diagrams.
- Document remains visibly themed while editing.

Unsupported or ambiguous Markdown must appear as an editable **Raw Markdown block**, not be silently deleted or rewritten.

## Markdown view

Purpose: exact source control.

- Monospaced editor.
- Syntax highlighting.
- Line numbers optional.
- Search and replace.
- Diagnostics for broken links, malformed frontmatter, invalid Mermaid, and unsupported extensions.
- Formatting command.
- Outline and symbol navigation.
- Git diff integration.

## Split view

Purpose: technical editing with immediate validation.

- Markdown source on the left.
- Rendered preview on the right.
- Adjustable divider.
- Synchronized scroll.
- Cursor-to-preview and preview-to-source navigation.
- Preview updates after a short debounce.

This is Adham’s enhanced version of the Markdown Live Preview interaction.[[1]](https://markdownlivepreview.com/)

# 3. Document header

Recommended controls:

- File name and relative project path.
- Saved, modified, conflict, or read-only state.
- Reader/Visual/Markdown/Split switcher.
- Theme picker.
- Outline toggle.
- Collaboration presence when available.
- Open externally.
- Export.
- Overflow menu.

The project and file permission boundary remains visible through the surrounding Compose workspace.

# 4. Theme system

Themes change presentation, not document meaning.

Built-in themes:

- **Adham Neutral** — Default application document style.
- **Technical Docs** — Compact headings, strong code and table treatment.
- **Article** — Wider spacing and comfortable long-form reading.
- **Git-style** — Familiar repository-document appearance.
- **Report** — Print-oriented structure for professional exports.
- **Minimal** — Reduced decoration.

Each supports Light, Dark, and System appearance.

## Safe theme tokens

Themes should use constrained design tokens:

- Font families and scale.
- Content width.
- Line height.
- Spacing.
- Heading rhythm.
- Colors.
- Borders and radii.
- Code, table, quote, callout, and link styles.

Do not allow a normal theme to execute JavaScript or access application APIs.

## Theme scope

A theme can be chosen for:

- Current view only.
- This file.
- This project.
- Workspace default.
- Export only.

The settings hierarchy follows Frontend UX — Settings architecture.

# 5. Markdown dialect

Recommended baseline:

- CommonMark-compatible parsing.
- GitHub Flavored Markdown features such as tables, task lists, autolinks, and strikethrough.
- YAML frontmatter.
- Footnotes.
- Fenced code blocks.
- Mermaid diagrams.
- Math blocks and inline math.
- Definition lists only if they round-trip safely.

Adham-specific extensions should be minimal, documented, and preserved as portable text where possible.

## Raw HTML

Raw HTML inside Markdown is disabled or sanitized in Reader and Visual views by default.

Offer project policy options:

- Escape raw HTML.
- Render safe HTML subset.
- Trust this file or project after warning.

Scripts, event handlers, iframes, unsafe URLs, and arbitrary embedded application code remain blocked unless handled through a separate trusted artifact system.

# 6. Editing architecture

Recommended pipeline:

```
Markdown source
→ Markdown AST
→ validated document model
→ Visual editor / Reader renderer
→ sanitized HTML DOM
```

Visual edits operate on the document model and serialize back to Markdown.

## Round-trip rules

- Preserve unsupported syntax as raw nodes.
- Preserve frontmatter keys and ordering when practical.
- Avoid rewriting the entire file for a small edit.
- Preserve line endings and final newline style.
- Do not normalize unrelated content automatically.
- Show a diff before a visual edit causes a large source rewrite.
- Never lose unknown directives or embedded extensions silently.

# 7. HTML view and export

## Rendered HTML view

Reader and preview modes are already HTML-based internally, but users should experience them as a document—not as raw code.

## HTML source view

Advanced option under the overflow menu:

- Shows generated sanitized HTML.
- Read-only by default.
- Includes a copy action.
- Explains that edits must be made in Markdown or Visual mode.

Allowing direct HTML editing would create a second source of truth and break round-trip guarantees.

## Export HTML

Offer:

- **Standalone HTML:** Content, selected theme CSS, and safe local assets.
- **HTML folder:** HTML plus an assets directory.
- **Copy HTML:** For pasting into another application.
- **Publish artifact:** Creates an Adham artifact without replacing the `.md` source.

Exports may include:

- Document title and metadata.
- Table of contents.
- Syntax highlighting CSS.
- Rendered diagrams.
- Embedded or copied images according to user choice.

Exports must contain no Adham credentials, private paths, hidden memory, or agent-only context.

# 8. Visual editing safeguards

Visual editing can be lossy if implemented as arbitrary HTML editing. Avoid `contenteditable` over generated HTML without a structured editor model.

Requirements:

- Schema-based editor state.
- Explicit Markdown AST conversion.
- Tests for every supported block and inline node.
- Golden-file round-trip tests.
- Raw-node fallback.
- Undo and redo across view changes.
- Autosave with recoverable local history.

When a feature cannot round-trip safely, Visual Edit shows it without destructive editing and offers **Edit Markdown source**.

# 9. External modifications

Adham watches open files for changes made by VS Code, Cursor, terminal tools, Git, or agents.

If the document is clean:

- Reload automatically and preserve the nearest cursor position.

If Adham also has unsaved changes:

- Show a conflict banner.
- Offer compare, keep mine, use disk version, or merge.
- Never overwrite the external version silently.

# 10. Agent behavior

Agents edit the Markdown source through project-scoped file tools. They do not manipulate the rendered DOM.

Before an agent modifies an open document:

- Adham records a checkpoint.
- The editor receives the filesystem event.
- The user can inspect the source or rendered diff.
- The selected view remains active.

For large document generation, stream a temporary preview but commit the final valid Markdown atomically.

# 11. Context-panel integration

When a Markdown file is opened from the Compose workspace, the right context panel can display it as an artifact.

Actions:

- Pin as artifact.
- Open in full editor.
- Switch Reader/Visual/Markdown/Split views.
- Add to session context.
- Add to project knowledge.
- Compare changes.
- Export HTML or PDF.
- Open in an external editor.

# 12. Security model

Rendered documents are untrusted content.

Required safeguards:

- Sanitize generated HTML.
- Strict content security policy.
- Block scripts and inline event handlers.
- Restrict external images and remote fonts according to privacy policy.
- Confirm navigation to unsafe or external schemes.
- Open external links through a controlled handler.
- Render Mermaid and similar diagrams in an isolated worker or sandbox.
- Never allow Markdown to invoke Adham IPC directly.
- Prevent `file://` links from escaping approved project boundaries.

# 13. Suggested implementation layers

For the TypeScript frontend:

- Code editor layer for Markdown source.
- CommonMark/GFM parser producing a Markdown AST.
- AST transformation and validation layer.
- Sanitized HTML renderer.
- Schema-driven rich-text editor for Visual mode.
- Theme-token system rendered by Adham.

The exact libraries remain an implementation decision. Select libraries based on round-trip quality, security, accessibility, performance on large files, and compatibility with strict TypeScript—not only on demo appearance.

# 14. File-level preferences

Do not write Adham view preferences into the Markdown file by default.

Store them in project-private settings:

```
file identity → preferred view, theme, width, outline state
```

When the user wants portable publishing metadata, allow optional YAML frontmatter:

```yaml
---
title: Architecture overview
theme: technical-docs
toc: true
---
```

Unknown frontmatter remains untouched. Theme metadata is a preference hint; another Markdown application may safely ignore it.

# 15. Empty and error states

## Unsupported syntax

Render a raw source block with a warning and preserve content.

## Invalid Mermaid or math

Show the source, error message, and **Edit block** action without breaking the rest of the document.

## Missing image

Preserve alt text and path. Offer reconnect, locate, or remove.

## Very large file

Start in Markdown or Reader mode, virtualize rendering, and warn before activating expensive Visual mode.

## Read-only file

Keep all views available, disable editing controls, and explain the filesystem or policy restriction.

# 16. Acceptance criteria

- `.md` remains the canonical source in every view.
- Reader mode produces a clean themed document.
- Visual mode edits Markdown through a structured model.
- Markdown mode exposes exact source.
- Split mode provides synchronized live preview.
- Switching views never creates a second editable HTML source.
- Unsupported syntax is preserved rather than deleted.
- Themes cannot execute code.
- Raw HTML is sanitized according to project policy.
- HTML export is explicit and contains no private Adham data.
- External edits never get overwritten silently.
- Agent edits produce checkpoints and inspectable diffs.
- View and theme preferences do not pollute the `.md` file by default.
- Files remain usable in other Markdown applications.