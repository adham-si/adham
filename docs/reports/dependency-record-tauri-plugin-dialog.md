# Dependency record — `tauri-plugin-dialog`

**Date:** 2026-10-23  
**Decision:** accepted for the native Save As panel used by Markdown export in PR #39  
**Human approval:** operator approved native Save As on 2026-10-23 with the requirement to keep the selected destination narrow, preserve the plaintext warning/5 MB cap/atomic write, and complete this record before commit.

The dependency is committed on the PR #39 branch but is not merged or released. This record was completed before the dependency commit; no shipped artifact contains it yet.

## Section 9 record

| Field | Record |
|---|---|
| Purpose and owner | Open the operating system's native Save As panel and return the user-selected destination path for Markdown export. Owner: desktop shell / history export. The webview never receives filesystem access; Rust receives only the chosen path. |
| Package and version | `tauri-plugin-dialog = "=2.8.3"` in `apps/desktop/src-tauri/Cargo.toml`; `Cargo.lock` resolves `tauri-plugin-dialog 2.8.3`. Compatible Tauri runtime in the lockfile: `2.12.1`. |
| License | `Apache-2.0 OR MIT` (package manifest). Transitive `tauri-plugin-fs 2.7.1` is also `Apache-2.0 OR MIT`; `rfd 0.16.1` is `MIT`. `cargo deny check` reports licenses ok on 2026-10-23. |
| Maintenance activity | Official plugin in the Tauri `plugins-workspace` repository (`github.com/tauri-apps/plugins-workspace`). Version 2.8.3 is the resolved release in this lockfile; re-review the plugin release notes and transitive graph on upgrade. |
| Security history | `cargo deny check` on 2026-10-23: advisories ok, bans ok, licenses ok, sources ok for the resolved workspace graph. No advisory specific to `tauri-plugin-dialog 2.8.3`, `tauri-plugin-fs 2.7.1`, or `rfd 0.16.1` was reported by that check. |
| Transitive dependency impact | The plugin brings `tauri-plugin-fs 2.7.1`, `rfd 0.16.1`, `tauri-plugin 2.7.2`, and platform bindings. `tauri-plugin-fs` is **not** registered in `lib.rs` and grants no `fs:` capability; `capabilities/default.json` contains only core window permissions. Only the Rust-side dialog API is used. |
| Native build implications | macOS uses AppKit/Objective-C bindings (`objc2-app-kit` et al.); Linux uses GTK3 system bindings (`gtk-sys`, `glib-sys`, `gobject-sys`) and the existing CI GTK/WebKit packages; Windows uses `windows-sys`. The plugin adds no runtime service or network listener. |
| Cross-platform support | macOS, Windows, and Linux are covered by separate CI jobs. The native panel itself is exercised on macOS only; Windows/Linux CI compiles and tests the code but does not open a GUI dialog in a headless runner. |
| Standard-library sufficiency | No standard-library API opens a native save panel. The alternative is per-OS FFI or a fixed export path. A fixed path was rejected because it cannot meet Save As, and the selected destination must remain user-controlled. |
| Exit strategy | Remove `tauri-plugin-dialog` from `Cargo.toml`, remove `.plugin(tauri_plugin_dialog::init())` and the dialog call in `export_session_markdown`, and delete the generated dialog ACL schemas. The export service accepts a destination path and is independent of the dialog; exported Markdown and session data are unaffected. A replacement would need its own native-dialog review. |

## Boundaries

- Save As cancellation returns `null`; it does not call the export service.
- The plugin returns a path only. The Rust service validates session scope, active state, and live-operation state before the panel opens, and again after a destination is chosen.
- The service keeps the existing 5 MB cap, plaintext warning, unique sibling temporary file, atomic replacement, and Unix `0600` mode. Windows files inherit destination-directory ACLs; the app does not claim `0600` on Windows.
- The dialog's overwrite confirmation is the native panel's. If a platform panel does not prompt, the export must not silently replace an existing file; that platform-specific behavior is not claimed as verified here.
