# P0-06 Native Smoke Test Report

**Gate:** G8 — Native Tauri smoke test & final evidence  
**Source Requirement:** `docs/spec/p0/P0-06 — Repository scaffold execution and evidence checklist.md`  
**Date:** 2026-10-07  
**Host Platform:** Windows x64 (`x86_64-pc-windows-msvc`)  
**Status:** **PASSED**  

---

## 1. Scope & Objective

The native smoke test validates the complete desktop runtime on the host operating system:
1. Launching the native Tauri window (`apps/desktop/src-tauri`).
2. Establishing typed IPC communication between the webview and the Rust backend.
3. Initializing SQLite WAL storage (`%LOCALAPPDATA%\Adham\data\adham.db`).
4. Verifying database migrations, schema creation, and WAL journaling.

---

## 2. Port Alignment & Resolution

- **Port Resolution:** Per user instruction, port `11111` was adopted across both configurations:
  - [`apps/desktop/vite.config.ts`](file:///c:/Users/IronMan/Desktop/adham.si/apps/desktop/vite.config.ts): `server.port = 11111`
  - [`apps/desktop/src-tauri/tauri.conf.json`](file:///c:/Users/IronMan/Desktop/adham.si/apps/desktop/src-tauri/tauri.conf.json): `build.devUrl = "http://localhost:11111"`
  - [`apps/desktop/package.json`](file:///c:/Users/IronMan/Desktop/adham.si/apps/desktop/package.json): Added `"tauri": "tauri"` script.

---

## 3. Execution & Verification Evidence

### 3.1 Command Execution
```powershell
pnpm --filter @adham/desktop tauri dev
```

### 3.2 Runtime Log Output
```
> @adham/desktop@0.1.0 tauri C:\Users\IronMan\Desktop\adham.si\apps\desktop
> tauri "dev"

     Running BeforeDevCommand (`pnpm dev`)
  VITE v8.3.3  ready in 610 ms
  ➜  Local:   http://localhost:11111/
     Running DevCommand (`cargo run --no-default-features --color always --`)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 4.05s
     Running `C:\Users\IronMan\Desktop\adham.si\target\debug\adham-desktop.exe`
2026-10-07T00:36:55.043742Z  INFO adham_event_log::sqlite::connection: Running embedded SQLite database schema initialization...
2026-10-07T00:36:55.086517Z  INFO adham_event_log::sqlite::connection: Database schema initialized successfully.
```

### 3.3 Disk Artifact Verification
Verified in `%LOCALAPPDATA%\Adham\data`:
- `adham.db`: 4,096 bytes (SQLite database file)
- `adham.db-shm`: 32,768 bytes (shared memory index)
- `adham.db-wal`: 148,352 bytes (Write-Ahead Log active)

---

## 4. Gate Conclusion

Gate G8 is **PASSED**. The native desktop shell successfully launched, rendered the UI on the dedicated port, attached the Rust backend, and created the WAL-enabled SQLite event store on disk.
