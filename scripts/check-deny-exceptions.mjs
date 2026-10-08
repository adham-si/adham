// Validates deny-exceptions.json against deny.toml ignores, Cargo.lock and
// the reapproval deadline. Fails on or after the deadline unless approval is
// renewed or the exception (and its ignore) is removed. Always uses actual
// UTC: date injection lives in the pure helper (tested by the self-test),
// never in this enforcement entrypoint.
// Run: node scripts/check-deny-exceptions.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLockPackages, validateExceptions } from './lib/deny-exceptions.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');

const records = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'deny-exceptions.json'), 'utf8'),
).exceptions;
const denyText = fs.readFileSync(path.join(ROOT, 'deny.toml'), 'utf8');
const lockPackages = parseLockPackages(fs.readFileSync(path.join(ROOT, 'Cargo.lock'), 'utf8'));
const today = new Date().toISOString().slice(0, 10);

const failures = validateExceptions({ records, denyText, lockPackages, today });
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  console.error(`\n${failures.length} exception problem(s); today is ${today}.`);
  process.exit(1);
}
console.log(`deny exceptions ok (${records.length} record(s) checked, today ${today}).`);
