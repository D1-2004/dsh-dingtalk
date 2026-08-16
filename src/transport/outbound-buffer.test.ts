import { describe, it, expect, vi } from 'vitest';
import { OutboundBuffer, type DingTalkSender } from './outbound-buffer.js';
import type { SessionRecord } from '../session/index.js';
import type { Logger } from '../types.js';

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeRecord(): SessionRecord {
  return {
    sessionKey: 'k',
    sessionId: 's',
    agent: {} as SessionRecord['agent'],
    handle: { agent: {} as SessionRecord['agent'], dispose: async () => {} },
    replyTarget: { scope: 'direct', targetId: 'u1' },
    scope: 'direct',
    peerId: 'u1',
    senderId: 'u1',
    lastActivity: Date.now(),
  };
}

describe('OutboundBuffer', () => {
  it('append 累积文本，flush 后清空', async () => {
    const sent: string[] = [];
    const sender: DingTalkSender = {
      sendMarkdown: async (_record, content) => {
        sent.push(content);
      },
    };
    const buffer = new OutboundBuffer(makeRecord(), sender, 100, noopLogger);

    buffer.append('hello ');
    buffer.append('world');
    expect(buffer.text).toBe('hello world');

    await buffer.flush();
    expect(sent).toEqual(['hello world']);
    expect(buffer.text).toBe('');
  });

  it('超过 limit 时分块发送', async () => {
    const sent: string[] = [];
    const sender: DingTalkSender = {
      sendMarkdown: async (_record, content) => {
        sent.push(content);
      },
    };
    const buffer = new OutboundBuffer(makeRecord(), sender, 30, noopLogger);

    buffer.append(Array.from({ length: 10 }, (_, i) => `line-${i}`).join('\n'));
    await buffer.flush();

    expect(sent.length).toBeGreaterThan(1);
    expect(sent.join('\n')).toContain('line-9');
  });

  it('空白内容不发送', async () => {
    const sendMarkdown = vi.fn(async () => {});
    const buffer = new OutboundBuffer(makeRecord(), { sendMarkdown }, 100, noopLogger);

    buffer.append('   \n  ');
    await buffer.flush();
    expect(sendMarkdown).not.toHaveBeenCalled();
  });

  it('发送失败不抛出、缓冲仍清空', async () => {
    const sender: DingTalkSender = {
      sendMarkdown: async () => {
        throw new Error('boom');
      },
    };
    const buffer = new OutboundBuffer(makeRecord(), sender, 100, noopLogger);

    buffer.append('text');
    await expect(buffer.flush()).resolves.toBeUndefined();
    expect(buffer.text).toBe('');
  });

  it('cancel 清空缓冲', () => {
    const buffer = new OutboundBuffer(makeRecord(), { sendMarkdown: async () => {} }, 100, noopLogger);
    buffer.append('text');
    buffer.cancel();
    expect(buffer.text).toBe('');
  });
});
