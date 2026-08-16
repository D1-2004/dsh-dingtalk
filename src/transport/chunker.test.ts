import { describe, it, expect } from 'vitest';
import { chunkMarkdownText } from './chunker.js';

describe('chunkMarkdownText', () => {
  it('短文本不切分', () => {
    expect(chunkMarkdownText('hello', 100)).toEqual(['hello']);
  });

  it('超长文本按行切分且不超限', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line-${i}`).join('\n');
    const chunks = chunkMarkdownText(text, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(50);
    }
    expect(chunks.join('\n')).toBe(text);
  });

  it('不在代码块中间断开围栏行', () => {
    const code = ['```js', ...Array.from({ length: 20 }, (_, i) => `const x${i} = ${i};`), '```'].join('\n');
    const text = `前置说明\n${code}\n后置说明`;
    const chunks = chunkMarkdownText(text, 120);
    // 每个 chunk 内围栏标记数为偶数或代码延续到下一 chunk（不做行内截断）
    for (const chunk of chunks) {
      for (const line of chunk.split('\n')) {
        expect(line.includes('const') && line.includes('```')).toBe(false);
      }
    }
    expect(chunks.join('\n')).toBe(text);
  });

  it('GFM 表格整体不被拆行切断', () => {
    const table = ['| a | b |', '| - | - |', '| 1 | 2 |', '| 3 | 4 |'].join('\n');
    const text = `标题\n${table}\n结尾`;
    const chunks = chunkMarkdownText(text, 60);
    const tableChunk = chunks.find((c) => c.includes('| a | b |'));
    expect(tableChunk).toBeDefined();
    expect(tableChunk).toContain('| 3 | 4 |');
  });

  it('单行超限时保留该行（不截断行内容）', () => {
    const long = 'x'.repeat(200);
    const chunks = chunkMarkdownText(`${long}\nshort`, 100);
    expect(chunks[0]).toBe(long);
    expect(chunks[1]).toBe('short');
  });
});
