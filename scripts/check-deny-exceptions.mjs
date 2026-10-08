// Validates deny-exceptions.json against deny.toml ignores, Cargo.lock and
// the reapproval deadline. Fails on or after the deadline unless approval is
// renewed or the exception (and its ignore) is removed.
// Run: node scripts/check-deny-exceptions.mjs [--today=YYYY-MM-DD]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseAdvisoryIgnoreIds,
  parseLockPackages,
  validateExceptions,
} from './lib/deny-exceptions.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');

function todayUtc() {
  const override = process.env.DENY_EXCEPTIONS_TODAY;
  const flag = process.argv.find((arg) => arg.startsWith('--today='))?.slice('--today='.length);
  return flag ?? override ?? new Date().toISOString().slice(0, 10);
}

const records = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'deny-exceptions.json'), 'utf8'),
).exceptions;
const ignoreIds = parseAdvisoryIgnoreIds(fs.readFileSync(path.join(ROOT, 'deny.toml'), 'utf8'));
const lockPackages = parseLockPackages(fs.readFileSync(path.join(ROOT, 'Cargo.lock'), 'utf8'));
const today = todayUtc();

const failures = validateExceptions({ records, ignoreIds, lockPackages, today });
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  console.error(`\n${failures.length} exception problem(s); today is ${today}.`);
  process.exit(1);
}
console.log(`deny exceptions ok (${records.length} record(s) checked, today ${today}).`);
