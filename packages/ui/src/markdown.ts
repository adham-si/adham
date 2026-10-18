/**
 * A small, dependency-free CommonMark/GFM subset parser.
 *
 * Model output is untrusted: this parser produces data (tokens), never HTML,
 * and it must never throw on partial input — a streaming answer is parsed on
 * every delta, so an incomplete construct can only ever degrade to literal
 * text, never break the timeline. Anything not understood stays literal.
 */

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; tokens: InlineToken[] }
  | { kind: 'em'; tokens: InlineToken[] }
  | { kind: 'strike'; tokens: InlineToken[] }
  | { kind: 'link'; text: string; url: string; safe: boolean }
  | { kind: 'image'; alt: string; url: string };

export interface ListItem {
  tokens: InlineToken[];
  blocks: MarkdownBlock[];
}

export type MarkdownBlock =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; tokens: InlineToken[] }
  | { kind: 'paragraph'; tokens: InlineToken[] }
  | { kind: 'code'; language: string; text: string; closed: boolean }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { kind: 'quote'; blocks: MarkdownBlock[] }
  | { kind: 'table'; header: InlineToken[][]; rows: InlineToken[][][] }
  | { kind: 'rule' };

const ATX_HEADING = /^ {0,3}(#{1,6})(?!#)(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const QUOTE_LINE = /^ {0,3}> ?(.*)$/;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;
const AUTOLINK = /^<(https?:|mailto:)([^\s>]+)>/i;
const ALLOWED_URL = /^(?:https?:|mailto:)/i;
const ESCAPABLE = /[\\`*_[\]()<>#+\-.!|~]/;

/** Bound for recursive descent: hostile nesting must not exhaust the stack. */
const MAX_DEPTH = 12;
const MAX_INLINE_DEPTH = 8;

export function parseMarkdown(source: string): MarkdownBlock[] {
  return parseBlocks(source.replace(/\r\n?/g, '\n').split('\n'));
}

export function parseInline(source: string, depth = 0): InlineToken[] {
  if (depth > MAX_INLINE_DEPTH) return [{ kind: 'text', text: source }];

  const tokens: InlineToken[] = [];
  let buffer = '';
  let i = 0;

  const flush = () => {
    if (buffer !== '') {
      tokens.push({ kind: 'text', text: buffer });
      buffer = '';
    }
  };

  while (i < source.length) {
    const char = source[i];

    if (char === '\\' && i + 1 < source.length && ESCAPABLE.test(source[i + 1] ?? '')) {
      buffer += source[i + 1];
      i += 2;
      continue;
    }

    if (char === '`') {
      const run = /^`+/.exec(source.slice(i))?.[0] ?? '`';
      const close = source.indexOf(run, i + run.length);
      if (close !== -1) {
        // Line breaks inside a code span collapse to a space (CommonMark).
        let text = source.slice(i + run.length, close).replace(/\n/g, ' ');
        if (text.length >= 2 && text.startsWith(' ') && text.endsWith(' ')) {
          text = text.slice(1, -1);
        }
        flush();
        tokens.push({ kind: 'code', text });
        i = close + run.length;
        continue;
      }
      buffer += run;
      i += run.length;
      continue;
    }

    if (char === '*' || char === '_') {
      const strong = source.startsWith(char + char, i);
      const marker = strong ? char + char : char;
      const afterOpen = source[i + marker.length];
      const intraword = char === '_' && i > 0 && isWordChar(source[i - 1]);
      if (!intraword && afterOpen !== undefined && !isSpace(afterOpen)) {
        const close = findClose(source, i + marker.length, marker, char === '_');
        if (close !== -1) {
          flush();
          tokens.push({
            kind: strong ? 'strong' : 'em',
            tokens: parseInline(source.slice(i + marker.length, close), depth + 1),
          });
          i = close + marker.length;
          continue;
        }
      }
    }

    if (char === '~' && source.startsWith('~~', i)) {
      const afterOpen = source[i + 2];
      if (afterOpen !== undefined && !isSpace(afterOpen)) {
        const close = source.indexOf('~~', i + 2);
        if (close !== -1 && close > i + 2 && !isSpace(source[close - 1])) {
          flush();
          tokens.push({
            kind: 'strike',
            tokens: parseInline(source.slice(i + 2, close), depth + 1),
          });
          i = close + 2;
          continue;
        }
      }
    }

    if (char === '!' && source[i + 1] === '[') {
      const image = readLinkTarget(source, i + 1);
      if (image) {
        flush();
        tokens.push({ kind: 'image', alt: image.text, url: image.url });
        i = image.end;
        continue;
      }
    }

    if (char === '[') {
      const link = readLinkTarget(source, i);
      if (link) {
        flush();
        tokens.push({ kind: 'link', text: link.text, url: link.url, safe: isSafeUrl(link.url) });
        i = link.end;
        continue;
      }
    }

    if (char === '<') {
      const autolink = AUTOLINK.exec(source.slice(i));
      if (autolink) {
        const url = `${group(autolink, 1)}${group(autolink, 2)}`;
        flush();
        tokens.push({ kind: 'link', text: url, url, safe: isSafeUrl(url) });
        i += group(autolink, 0).length;
        continue;
      }
    }

    buffer += char;
    i += 1;
  }

  flush();
  return tokens;
}

/**
 * Only explicitly supported schemes become openable links. Whitespace and
 * control characters are stripped before matching (the way a browser strips
 * them) so obfuscated schemes like `java\nscript:` cannot slip through.
 * Relative targets are rejected: they would resolve against the app shell,
 * not the model's intent.
 */
export function isSafeUrl(raw: string): boolean {
  let collapsed = '';
  for (const char of raw) {
    if (char.charCodeAt(0) > 0x20) collapsed += char;
  }
  return ALLOWED_URL.test(collapsed);
}

function parseBlocks(lines: string[], depth = 0): MarkdownBlock[] {
  if (depth > MAX_DEPTH) {
    return lines
      .filter((line) => line.trim() !== '')
      .map((line) => ({
        kind: 'paragraph',
        tokens: [{ kind: 'text', text: line }],
      }));
  }

  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lineAt(lines, i);
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      const parsed = parseFence(lines, i, fence);
      blocks.push(parsed.block);
      i = parsed.next;
      continue;
    }

    const heading = ATX_HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: group(heading, 1).length as 1 | 2 | 3 | 4 | 5 | 6,
        tokens: parseInline(group(heading, 2)),
      });
      i += 1;
      continue;
    }

    if (THEMATIC_BREAK.test(line)) {
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    if (QUOTE_LINE.test(line)) {
      const quote = parseQuote(lines, i, depth);
      blocks.push(quote.block);
      i = quote.next;
      continue;
    }

    if (isTableStart(lines, i)) {
      const table = parseTable(lines, i);
      blocks.push(table.block);
      i = table.next;
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      const list = parseList(lines, i, group(item, 1).length, depth);
      blocks.push(list.block);
      i = list.next;
      continue;
    }

    const paragraph: string[] = [line];
    i += 1;
    while (i < lines.length && lineAt(lines, i).trim() !== '' && !startsBlock(lines, i)) {
      paragraph.push(lineAt(lines, i));
      i += 1;
    }
    blocks.push({ kind: 'paragraph', tokens: parseInline(paragraph.join('\n')) });
  }

  return blocks;
}

function parseFence(lines: string[], start: number, open: RegExpExecArray) {
  const fence = group(open, 1);
  const language =
    group(open, 2)
      .trim()
      .split(/[ \t]+/)[0] ?? '';
  const content: string[] = [];
  let i = start + 1;
  let closed = false;

  while (i < lines.length) {
    if (isFenceClose(lineAt(lines, i), fence.charAt(0), fence.length)) {
      closed = true;
      i += 1;
      break;
    }
    content.push(lineAt(lines, i));
    i += 1;
  }

  return {
    block: { kind: 'code', language, text: content.join('\n'), closed } as MarkdownBlock,
    next: i,
  };
}

function isFenceClose(line: string, char: string, minLength: number): boolean {
  const trimmed = line.trim();
  if (trimmed.length < minLength) return false;
  for (const candidate of trimmed) if (candidate !== char) return false;
  return true;
}

function parseQuote(lines: string[], start: number, depth: number) {
  const inner: string[] = [];
  let i = start;

  while (i < lines.length) {
    const quoted = QUOTE_LINE.exec(lineAt(lines, i));
    if (quoted) {
      inner.push(group(quoted, 1));
      i += 1;
      continue;
    }
    if (
      lineAt(lines, i).trim() === '' &&
      i + 1 < lines.length &&
      QUOTE_LINE.test(lineAt(lines, i + 1))
    ) {
      inner.push('');
      i += 1;
      continue;
    }
    break;
  }

  return {
    block: { kind: 'quote', blocks: parseBlocks(inner, depth + 1) } as MarkdownBlock,
    next: i,
  };
}

function parseList(lines: string[], start: number, baseIndent: number, depth: number) {
  const first = LIST_ITEM.exec(lineAt(lines, start));
  const ordered = first ? /^\d/.test(group(first, 2)) : false;
  const startNumber = ordered && first ? Number.parseInt(group(first, 2), 10) : 1;
  const items: ListItem[] = [];
  let i = start;

  while (i < lines.length) {
    const item = LIST_ITEM.exec(lineAt(lines, i));
    if (!item || group(item, 1).length !== baseIndent || /^\d/.test(group(item, 2)) !== ordered) {
      break;
    }

    const contentIndent = baseIndent + group(item, 2).length + 1;
    const childLines: string[] = [];
    let j = i + 1;

    while (j < lines.length) {
      const line = lineAt(lines, j);
      if (line.trim() === '') {
        let k = j;
        while (k < lines.length && lineAt(lines, k).trim() === '') k += 1;
        if (k < lines.length && countIndent(lineAt(lines, k)) >= contentIndent) {
          childLines.push('');
          j = k;
          continue;
        }
        break;
      }
      if (countIndent(line) < contentIndent) break;
      childLines.push(line.slice(contentIndent));
      j += 1;
    }

    items.push({
      tokens: parseInline(group(item, 4)),
      blocks: childLines.some((line) => line.trim() !== '')
        ? parseBlocks(childLines, depth + 1)
        : [],
    });
    i = j;
  }

  return {
    block: { kind: 'list', ordered, start: startNumber, items } as MarkdownBlock,
    next: i,
  };
}

function parseTable(lines: string[], start: number) {
  const header = splitRow(lineAt(lines, start)).map((cell) => parseInline(cell));
  const rows: InlineToken[][][] = [];
  let i = start + 2;

  while (i < lines.length && lineAt(lines, i).trim() !== '' && lineAt(lines, i).includes('|')) {
    const cells = splitRow(lineAt(lines, i)).slice(0, header.length);
    while (cells.length < header.length) cells.push('');
    rows.push(cells.map((cell) => parseInline(cell)));
    i += 1;
  }

  return { block: { kind: 'table', header, rows } as MarkdownBlock, next: i };
}

function isTableStart(lines: string[], index: number): boolean {
  return (
    lineAt(lines, index).includes('|') &&
    index + 1 < lines.length &&
    isTableDelimiter(lineAt(lines, index + 1))
  );
}

function isTableDelimiter(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '' || !/^[|\s:-]+$/.test(trimmed) || !trimmed.includes('-')) return false;
  const cells = splitRow(trimmed).filter((cell) => cell !== '');
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);

  const cells: string[] = [];
  let buffer = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\\' && text[i + 1] === '|') {
      buffer += '|';
      i += 1;
      continue;
    }
    if (char === '|') {
      cells.push(buffer.trim());
      buffer = '';
      continue;
    }
    buffer += char;
  }
  cells.push(buffer.trim());
  return cells;
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lineAt(lines, index);
  return (
    FENCE_OPEN.test(line) ||
    ATX_HEADING.test(line) ||
    THEMATIC_BREAK.test(line) ||
    QUOTE_LINE.test(line) ||
    LIST_ITEM.test(line) ||
    isTableStart(lines, index)
  );
}

function readLinkTarget(
  source: string,
  bracket: number,
): { text: string; url: string; end: number } | null {
  const close = source.indexOf(']', bracket + 1);
  if (close === -1 || source[close + 1] !== '(') return null;
  const end = findClosingParen(source, close + 2);
  if (end === -1) return null;

  const raw = source.slice(close + 2, end).trim();
  const url =
    raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : (raw.split(/[ \t]/)[0] ?? '');
  return { text: source.slice(bracket + 1, close), url, end: end + 1 };
}

/** Balanced scan so a target containing parentheses is not truncated. */
function findClosingParen(source: string, from: number): number {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    const char = source[i];
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

function findClose(source: string, from: number, marker: string, wordBound: boolean): number {
  let index = source.indexOf(marker, from);
  while (index !== -1) {
    const previous = source[index - 1];
    const next = source[index + marker.length];
    if (!isSpace(previous) && !(wordBound && next !== undefined && isWordChar(next))) {
      return index;
    }
    index = source.indexOf(marker, index + 1);
  }
  return -1;
}

function countIndent(line: string): number {
  let indent = 0;
  while (indent < line.length && line[indent] === ' ') indent += 1;
  return indent;
}

/** Indexed access with the reassurance the parser's own length checks give. */
function lineAt(lines: string[], index: number): string {
  return lines[index] ?? '';
}

/** Match-group access: missing groups read as '' instead of undefined. */
function group(match: RegExpExecArray | null, index: number): string {
  return match?.[index] ?? '';
}

function isSpace(char: string | undefined): boolean {
  return char === undefined || char === ' ' || char === '\t' || char === '\n';
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[a-zA-Z0-9]/.test(char);
}
