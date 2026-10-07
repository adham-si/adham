import fs from 'node:fs';

/**
 * Strips comments so the gate does not fire on prose. A rule that flags
 * `// see PR #1234` is a rule people learn to bypass.
 *
 * Preserves string literals so a hex colour inside a string still counts.
 */
export function stripComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i];

    if (ch === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }

    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        if (source[i] === '\\') {
          out += source[i] + (source[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/** Returns the ids of every rule the given line violates. */
export function detect(line, rules) {
  const ids = [];
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    if ([...line.matchAll(rule.pattern)].length > 0) ids.push(rule.id);
  }
  return ids;
}

/** Loads the rule set from check-magic-values.rules.json. */
export function loadRules(rulesUrl) {
  return JSON.parse(fs.readFileSync(rulesUrl, 'utf8')).map((rule) => ({
    ...rule,
    pattern: new RegExp(rule.pattern, 'g'),
  }));
}
