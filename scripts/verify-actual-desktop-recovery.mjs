import { spawn } from 'node:child_process';
import { rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const WORKTREE_ROOT = process.cwd();
const BINARY_PATH = join(WORKTREE_ROOT, 'target', 'release', 'adham-desktop');

if (!existsSync(BINARY_PATH)) {
  console.error(
    `Binary not found at ${BINARY_PATH}. Please run cargo build -p adham-desktop --release first.`,
  );
  process.exit(1);
}

const canaryId = randomUUID();
const tempHome = join('/tmp', `adham_canary_desktop_${canaryId}`);
const scopeFile = join(tempHome, 'canary_scope.txt');

mkdirSync(tempHome, { recursive: true });

if (process.platform === 'darwin' && process.env.HOME) {
  const libDir = join(tempHome, 'Library');
  mkdirSync(libDir, { recursive: true });
  const realKeychains = join(process.env.HOME, 'Library', 'Keychains');
  if (existsSync(realKeychains)) {
    try {
      const { symlinkSync } = await import('node:fs');
      symlinkSync(realKeychains, join(libDir, 'Keychains'));
    } catch {
      // ignore
    }
  }
}

const opId = randomUUID();
const createReqId = randomUUID();
const msgReqId = randomUUID();
const text = `Canary prompt for native recovery journey ${canaryId}`;
const title = `Canary Native Title ${canaryId}`;

const envBase = {
  ...process.env,
  HOME: tempHome,
  ADHAM_CANARY_OP_ID: opId,
  ADHAM_CANARY_CREATE_REQ_ID: createReqId,
  ADHAM_CANARY_MSG_REQ_ID: msgReqId,
  ADHAM_CANARY_TEXT: text,
  ADHAM_CANARY_TITLE: title,
  ADHAM_CANARY_SCOPE_FILE: scopeFile,
};

function runDesktopProcess(mode) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    console.log(`[JOURNEY] Launching actual Tauri desktop binary in mode: ${mode}...`);
    const proc = spawn(BINARY_PATH, [], {
      env: {
        ...envBase,
        ADHAM_CANARY_RECOVERY_MODE: mode,
      },
      cwd: WORKTREE_ROOT,
    });

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', reject);

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function run() {
  try {
    // 1. Process 1: Persist and Quit
    console.log(`[JOURNEY] Step 1: Starting Process 1 (persist unresolved operation)...`);
    const res1 = await runDesktopProcess('persist_and_quit');
    console.log(res1.stdout);
    if (res1.code !== 0) {
      console.error(`Process 1 failed with code ${res1.code}:\n${res1.stderr}`);
      process.exit(1);
    }
    if (!res1.stdout.includes('PERSIST_SUCCESS')) {
      console.error('Process 1 did not output PERSIST_SUCCESS');
      process.exit(1);
    }
    console.log(
      `[JOURNEY] Step 1 Complete: Process 1 persisted operation and quit cleanly (exit 0).`,
    );

    // 2. Process 2: Relaunch and Resend
    console.log(`[JOURNEY] Step 2: Relaunching desktop process (Process 2)...`);
    const res2 = await runDesktopProcess('relaunch_and_resend');
    console.log(res2.stdout);
    if (res2.code !== 0) {
      console.error(`Process 2 failed with code ${res2.code}:\n${res2.stderr}`);
      process.exit(1);
    }
    if (!res2.stdout.includes('RELAUNCH_SUCCESS')) {
      console.error('Process 2 did not output RELAUNCH_SUCCESS');
      process.exit(1);
    }
    console.log(
      `[JOURNEY] Step 2 Complete: Process 2 recovered original IDs, completed resend, and verified 0 duplicates.`,
    );

    console.log(`\n========================================`);
    console.log(`ACTUAL TAURI APP RECOVERY JOURNEY PASSED`);
    console.log(`- Operation ID: ${opId}`);
    console.log(`- Frozen Create Request ID: ${createReqId}`);
    console.log(`- Frozen Message Request ID: ${msgReqId}`);
    console.log(`- Zero duplicate sessions verified via receipt idempotency`);
    console.log(`- Zero duplicate messages verified via get_conversation history`);
    console.log(`- Pending operations queue fully cleared`);
    console.log(`========================================\n`);
  } finally {
    try {
      rmSync(tempHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

run();
