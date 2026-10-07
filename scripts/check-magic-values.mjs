import fs from 'node:fs';
import path from 'node:path';
import { detect, loadRules, stripComments } from './lib/magic-value-rules.mjs';

const ROOTS = ['packages/ui/src', 'apps/desktop/src'];
const EXTENSIONS = new Set(['.ts', '.tsx']);

const rules = loadRules(new URL('./check-magic-values.rules.json', import.meta.url));

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const violations = [];

for (const root of ROOTS) {
  if (!fs.existsSync(root)) {
    console.error(`[ERROR] scan root missing: ${root}`);
    process.exit(1);
  }
  for (const file of walk(root)) {
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    source.split('\n').forEach((line, index) => {
      for (const id of detect(line, rules)) {
        const rule = rules.find((r) => r.id === id);
        violations.push({ file, line: index + 1, rule: rule.id, message: rule.message });
      }
    });
  }
}

if (violations.length === 0) {
  console.log(
    'Magic-value check passed: no hex literals, arbitrary var() values, bare z-index utilities, or cleared Tailwind defaults.',
  );
  process.exit(0);
}

for (const v of violations) {
  console.error(`${v.file}:${v.line}  [${v.rule}]\n    ${v.message}`);
}
console.error(`\n${violations.length} magic-value violation(s) found.`);
process.exit(1);
