// Pure logic for the deny-exception validator. The CLI
// (scripts/check-deny-exceptions.mjs) wires these to the real
// deny-exceptions.json, deny.toml and Cargo.lock; the self-test exercises
// them with fixtures and injected dates. Run: node
// scripts/check-deny-exceptions.self-test.mjs

const ADVISORY_ID_PATTERN = /^RUSTSEC-\d{4}-\d+$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse `[[package]]` name/version pairs from Cargo.lock text. */
export function parseLockPackages(lockText) {
  const packages = new Map();
  const blocks = lockText.split('[[package]]');
  for (const block of blocks) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"/m.exec(block)?.[1];
    if (name && version) {
      if (!packages.has(name)) packages.set(name, new Set());
      packages.get(name).add(version);
    }
  }
  return packages;
}

/** Extract advisory `ignore` IDs from the `[advisories]` section of deny.toml. */
export function parseAdvisoryIgnoreIds(denyText) {
  const lines = denyText.split('\n');
  const start = lines.findIndex((line) => line.trim() === '[advisories]');
  if (start === -1) return [];
  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[.*\]\s*$/.test(line)) break;
    section.push(line);
  }
  const ids = [];
  for (const match of section.join('\n').matchAll(/id\s*=\s*"([^"]+)"/g)) {
    ids.push(match[1]);
  }
  return ids;
}

export function isValidDeadline(value) {
  const parts = DATE_PATTERN.exec(value ?? '');
  if (!parts) return false;
  const [, y, m, d] = parts.map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const roundTrip = new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
  return roundTrip === value;
}

/**
 * Validate exception records against deny.toml ignores, the lockfile and the
 * deadline. `today` is an explicit YYYY-MM-DD string so tests can inject
 * before/on/after-deadline dates. Returns an array of failure messages
 * (empty means pass).
 */
export function validateExceptions({ records, ignoreIds, lockPackages, today }) {
  const failures = [];
  if (!Array.isArray(records)) {
    return ['deny-exceptions.json must contain an "exceptions" array'];
  }

  const seen = new Set();
  for (const [index, record] of records.entries()) {
    const where = `exceptions[${index}]`;
    const fail = (message) => failures.push(`${where}: ${message}`);
    if (!record || typeof record !== 'object') {
      fail('must be an object');
      continue;
    }
    if (!ADVISORY_ID_PATTERN.test(record.id ?? '')) {
      fail(`id must look like RUSTSEC-YYYY-NNNN, got ${JSON.stringify(record.id)}`);
    } else if (seen.has(record.id)) {
      fail(`duplicate id ${record.id}`);
    } else {
      seen.add(record.id);
    }
    for (const field of ['crate', 'version', 'owner', 'deadline', 'rationale']) {
      if (typeof record[field] !== 'string' || record[field].trim() === '') {
        fail(`${field} must be a non-empty string`);
      }
    }
    if (!isValidDeadline(record.deadline)) {
      fail(`deadline must be a valid YYYY-MM-DD date, got ${JSON.stringify(record.deadline)}`);
    } else if (!(today < record.deadline)) {
      fail(
        `${record.id} expired on ${record.deadline} (today ${today}): renew approval or remove the exception and its ignore`,
      );
    }
    if (
      !Array.isArray(record.tracking) ||
      record.tracking.length === 0 ||
      record.tracking.some((t) => typeof t !== 'string' || t.trim() === '')
    ) {
      fail('tracking must be a non-empty array of non-empty strings');
    }
    if (typeof record.crate === 'string' && typeof record.version === 'string') {
      const locked = lockPackages.get(record.crate);
      if (!locked) {
        fail(`crate ${record.crate} is not in Cargo.lock: remove the exception and its ignore`);
      } else if (!locked.has(record.version)) {
        fail(
          `version ${record.version} of ${record.crate} is not locked ` +
            `(locked: ${[...locked].join(', ')}): re-scope or remove the exception`,
        );
      }
    }
    if (typeof record.id === 'string' && !ignoreIds.includes(record.id)) {
      fail(
        `${record.id} has no matching [advisories] ignore in deny.toml: add it or remove the record`,
      );
    }
  }

  for (const id of ignoreIds) {
    if (!seen.has(id)) {
      failures.push(
        `deny.toml ignores ${id} with no declared exception record: add a record or remove the ignore`,
      );
    }
  }
  return failures;
}
