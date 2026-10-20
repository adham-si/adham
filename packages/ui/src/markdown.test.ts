import { describe, expect, it } from 'vitest';
import { isSafeUrl, parseInline, parseMarkdown, type MarkdownBlock } from './markdown';

const kinds = (blocks: MarkdownBlock[]) => blocks.map((block) => block.kind);

function blockAt(source: string, index: number): MarkdownBlock {
  const block = parseMarkdown(source)[index];
  if (!block) throw new Error(`no block at ${index} in: ${source}`);
  return block;
}

function firstBlock(source: string): MarkdownBlock {
  return blockAt(source, 0);
}

describe('parseMarkdown blocks', () => {
  it('parses ATX headings at every level', () => {
    const blocks = parseMarkdown('# one\n## two\n### three\n#### four\n##### five\n###### six');
    expect(blocks.map((block) => (block.kind === 'heading' ? block.level : 'not-heading'))).toEqual(
      [1, 2, 3, 4, 5, 6],
    );
  });

  it('leaves seven hashes and hashtag text as paragraphs', () => {
    expect(kinds(parseMarkdown('####### seven'))).toEqual(['paragraph']);
    expect(kinds(parseMarkdown('#hashtag'))).toEqual(['paragraph']);
    expect(kinds(parseMarkdown('# Heading'))).toEqual(['heading']);
  });

  it('keeps soft line breaks inside a paragraph', () => {
    expect(firstBlock('first line\nsecond line')).toEqual({
      kind: 'paragraph',
      tokens: [{ kind: 'text', text: 'first line\nsecond line' }],
    });
  });

  it('parses bullet and ordered lists, preserving the start number', () => {
    const bullets = firstBlock('- one\n- two');
    if (bullets.kind !== 'list') throw new Error('expected a bullet list');
    expect(bullets.ordered).toBe(false);
    expect(bullets.items.map((item) => item.tokens)).toEqual([
      [{ kind: 'text', text: 'one' }],
      [{ kind: 'text', text: 'two' }],
    ]);

    const ordered = firstBlock('3. three\n4. four');
    if (ordered.kind !== 'list') throw new Error('expected an ordered list');
    expect(ordered.ordered).toBe(true);
    expect(ordered.start).toBe(3);
    expect(ordered.items).toHaveLength(2);
  });

  it('parses nested lists as child blocks of their item', () => {
    const list = firstBlock('- parent\n  - child\n- second');
    if (list.kind !== 'list') throw new Error('expected a list');
    expect(list.items).toHaveLength(2);
    expect(list.items[0]?.blocks.map((block) => block.kind)).toEqual(['list']);
    expect(list.items[1]?.blocks).toEqual([]);
  });

  it('parses blockquotes recursively', () => {
    const quote = firstBlock('> quoted\n> > deeper');
    if (quote.kind !== 'quote') throw new Error('expected a quote');
    expect(quote.blocks.map((block) => block.kind)).toEqual(['paragraph', 'quote']);
  });

  it('parses GFM tables with escaped pipes and normalizes row width', () => {
    const table = firstBlock('| a | b |\n| --- | --- |\n| 1 \\| x | 2 |\n| 3 |');
    if (table.kind !== 'table') throw new Error('expected a table');
    expect(table.header).toHaveLength(2);
    expect(table.rows[0]?.[0]).toEqual([{ kind: 'text', text: '1 | x' }]);
    expect(table.rows[1]).toEqual([[{ kind: 'text', text: '3' }], []]);
  });

  it('does not start a table without a delimiter row', () => {
    expect(kinds(parseMarkdown('| a | b |\nplain text'))).toEqual(['paragraph']);
  });

  it('parses thematic breaks', () => {
    expect(kinds(parseMarkdown('above\n\n---\n\nbelow'))).toEqual([
      'paragraph',
      'rule',
      'paragraph',
    ]);
  });

  it('parses fenced code with a language and without one', () => {
    expect(firstBlock('```ts\nconst x = 1;\n```')).toEqual({
      kind: 'code',
      language: 'ts',
      text: 'const x = 1;',
      closed: true,
    });
    expect(firstBlock('~~~\nplain\n~~~')).toEqual({
      kind: 'code',
      language: '',
      text: 'plain',
      closed: true,
    });
  });

  it('keeps an unterminated fence open instead of breaking', () => {
    const blocks = parseMarkdown('before\n\n```ts\nconst partial =');
    expect(blocks[1]).toEqual({
      kind: 'code',
      language: 'ts',
      text: 'const partial =',
      closed: false,
    });
  });

  it('keeps raw HTML as literal text', () => {
    const blocks = parseMarkdown('<script>alert(1)</script>');
    expect(blocks).toEqual([
      { kind: 'paragraph', tokens: [{ kind: 'text', text: '<script>alert(1)</script>' }] },
    ]);
  });

  it('never throws and stays usable for every prefix of a document', () => {
    const document = [
      '# Title',
      '',
      'Some **bold** and `code` text with [a link](https://example.com).',
      '',
      '- one',
      '  - nested',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '> quote',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      '![alt](https://example.com/image.png)',
    ].join('\n');

    for (let end = 0; end <= document.length; end += 1) {
      expect(Array.isArray(parseMarkdown(document.slice(0, end)))).toBe(true);
    }
  });

  it('bounds nesting depth instead of overflowing the stack', () => {
    const deepQuotes = Array.from({ length: 300 }, (_, i) => `${'>'.repeat(i + 1)} x`).join('\n');
    const deepLists = Array.from({ length: 300 }, (_, i) => `${'  '.repeat(i)}- x`).join('\n');
    expect(() => parseMarkdown(deepQuotes)).not.toThrow();
    expect(() => parseMarkdown(deepLists)).not.toThrow();
  });

  it('starts a new paragraph after a blank line', () => {
    expect(kinds(parseMarkdown('one\n\ntwo'))).toEqual(['paragraph', 'paragraph']);
  });

  it('treats plain prose as a single paragraph', () => {
    expect(firstBlock('Just a sentence.')).toEqual({
      kind: 'paragraph',
      tokens: [{ kind: 'text', text: 'Just a sentence.' }],
    });
  });
});

describe('parseInline', () => {
  it('parses code spans and keeps unmatched backticks literal', () => {
    expect(parseInline('use `npm run` here')).toEqual([
      { kind: 'text', text: 'use ' },
      { kind: 'code', text: 'npm run' },
      { kind: 'text', text: ' here' },
    ]);
    expect(parseInline('a ` b')).toEqual([{ kind: 'text', text: 'a ` b' }]);
  });

  it('parses emphasis, strong and strikethrough', () => {
    expect(parseInline('**bold** and *soft*')).toEqual([
      { kind: 'strong', tokens: [{ kind: 'text', text: 'bold' }] },
      { kind: 'text', text: ' and ' },
      { kind: 'em', tokens: [{ kind: 'text', text: 'soft' }] },
    ]);
    expect(parseInline('~~gone~~')).toEqual([
      { kind: 'strike', tokens: [{ kind: 'text', text: 'gone' }] },
    ]);
  });

  it('does not emphasize asterisks surrounded by spaces', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([{ kind: 'text', text: '2 * 3 * 4' }]);
  });

  it('keeps intraword underscores literal', () => {
    expect(parseInline('snake_case_name')).toEqual([{ kind: 'text', text: 'snake_case_name' }]);
  });

  it('parses links and flags unsafe targets', () => {
    expect(parseInline('[docs](https://example.com)')).toEqual([
      { kind: 'link', text: 'docs', url: 'https://example.com', safe: true },
    ]);
    expect(parseInline('[x](javascript:alert(1))')).toEqual([
      { kind: 'link', text: 'x', url: 'javascript:alert(1)', safe: false },
    ]);
    expect(parseInline('[w](https://en.wikipedia.org/wiki/Foo_(bar))')).toEqual([
      { kind: 'link', text: 'w', url: 'https://en.wikipedia.org/wiki/Foo_(bar)', safe: true },
    ]);
  });

  it('parses autolinks and images', () => {
    expect(parseInline('<https://example.com>')).toEqual([
      { kind: 'link', text: 'https://example.com', url: 'https://example.com', safe: true },
    ]);
    expect(parseInline('![alt](https://example.com/i.png)')).toEqual([
      { kind: 'image', alt: 'alt', url: 'https://example.com/i.png' },
    ]);
  });

  it('honours backslash escapes', () => {
    expect(parseInline('\\*not italic\\*')).toEqual([{ kind: 'text', text: '*not italic*' }]);
  });

  it('never parses emphasis inside a code span', () => {
    expect(parseInline('`a ** b`')).toEqual([{ kind: 'code', text: 'a ** b' }]);
  });

  it('does not overflow the stack on hostile delimiter runs', () => {
    expect(() => parseInline(`${'*'.repeat(80)}x${'*'.repeat(80)}`)).not.toThrow();
    expect(() => parseInline('![['.repeat(200))).not.toThrow();
    expect(() => parseInline('[]('.repeat(200))).not.toThrow();
  });
});

describe('isSafeUrl', () => {
  it.each(['https://example.com', 'http://example.com', 'HTTPS://EXAMPLE.COM', 'mailto:a@b.c'])(
    'allows %s',
    (url) => {
      expect(isSafeUrl(url)).toBe(true);
    },
  );

  it.each([
    'javascript:alert(1)',
    'java\nscript:alert(1)',
    'jav\tascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '/relative/path',
    'https//example.com',
    '',
  ])('rejects %s', (url) => {
    expect(isSafeUrl(url)).toBe(false);
  });
});
