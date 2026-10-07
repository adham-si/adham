import fs from 'node:fs';
import path from 'node:path';

const IGNORED_DIRS = new Set([
  'node_modules',
  'target',
  'dist',
  'gen',
  'docs',
  'contracts-generated',
  '.git',
  '.opencode',
  '.playwright-mcp',
  '.kilo',
]);

const IGNORED_FILES = new Set(['pnpm-lock.yaml', 'Cargo.lock', 'routeTree.gen.ts', 'LICENSE']);

let maxLimitExceeded = 0;
let reviewWarningCount = 0;

function scan(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        scan(path.join(dir, entry.name));
      }
    } else if (entry.isFile()) {
      if (IGNORED_FILES.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const ext = path.extname(entry.name);
      if (!['.ts', '.tsx', '.rs', '.sql', '.json', '.md'].includes(ext)) continue;

      const content = fs.readFileSync(fullPath, 'utf8');
      const lineCount = content.split('\n').length;

      if (lineCount > 600) {
        console.error(`[ERROR] File exceeds 600 line limit: ${fullPath} (${lineCount} lines)`);
        maxLimitExceeded++;
      } else if (lineCount > 400) {
        console.warn(
          `[WARN] File exceeds 400 line review threshold: ${fullPath} (${lineCount} lines)`,
        );
        reviewWarningCount++;
      }
    }
  }
}

scan('.');

console.log(
  `\nFile size check complete. Warnings (>400 lines): ${reviewWarningCount}, Errors (>600 lines): ${maxLimitExceeded}`,
);
if (maxLimitExceeded > 0) {
  process.exit(1);
}
