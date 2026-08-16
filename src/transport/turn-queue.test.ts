import { describe, it, expect } from 'vitest';
import { TurnQueue, mergePending } from './turn-queue.js';
import type { SessionManager, SessionRecord } from '../session/index.js';
import type { Logger } from '../types.js';

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

interface Captured {
  record: SessionRecord;
  followups: string[];
}

function makeRecord(sessionKey: string, sessionId: string): Captured {
  const followups: string[] = [];
  const agent = {
    followup: (message: unknown) => {
      const blocks = (message as { content?: Array<{ text?: string }> }).content ?? [];
      followups.push(blocks.map((b) => b.text ?? '').join(''));
    },
  };
  const record = {
    sessionKey,
    sessionId,
    agent,
    handle: { agent, dispose: async () => {} },
    replyTarget: { scope: 'direct', targetId: 'u1' },
    scope: 'direct',
    peerId: 'u1',
    senderId: 'u1',
    lastActivity: Date.now(),
  } as unknown as SessionRecord;
  return { record, followups };
}

function makeManager(records: SessionRecord[]): SessionManager {
  return {
    findBySessionId: (id: string) => records.find((r) => r.sessionId === id),
  } as unknown as SessionManager;
}

describe('TurnQueue', () => {
  it('空闲时立即投递', () => {
    const { record, followups } = makeRecord('k1', 's1');
    const queue = new TurnQueue(makeManager([record]), noopLogger);

    expect(queue.dispatch(record, 'hello')).toBe('sent');
    expect(followups).toEqual(['hello']);
  });

  it('busy 期间入队，turn 结束后合并投递', () => {
    const { record, followups } = makeRecord('k1', 's1');
    const queue = new TurnQueue(makeManager([record]), noopLogger);

    queue.dispatch(record, '第一条');
    expect(queue.dispatch(record, '补充A')).toBe('queued');
    expect(queue.dispatch(record, '补充B')).toBe('queued');
    expect(followups).toEqual(['第一条']);

    queue.onTurnEnd('s1');
    expect(followups.length).toBe(2);
    expect(followups[1]).toContain('连续发送了以下消息');
    expect(followups[1]).toContain('1. 补充A');
    expect(followups[1]).toContain('2. 补充B');
  });

  it('无 pending 的 turn 结束后回到空闲', () => {
    const { record, followups } = makeRecord('k1', 's1');
    const queue = new TurnQueue(makeManager([record]), noopLogger);

    queue.dispatch(record, '第一条');
    queue.onTurnEnd('s1');
    expect(queue.dispatch(record, '第二条')).toBe('sent');
    expect(followups).toEqual(['第一条', '第二条']);
  });

  it('合并投递后仍处于 busy，直到下一次 turn 结束', () => {
    const { record, followups } = makeRecord('k1', 's1');
    const queue = new TurnQueue(makeManager([record]), noopLogger);

    queue.dispatch(record, 'A');
    queue.dispatch(record, 'B');
    queue.onTurnEnd('s1'); // 投递合并批（B）
    expect(queue.dispatch(record, 'C')).toBe('queued');
    queue.onTurnEnd('s1');
    expect(followups[2]).toBe('C');
  });

  it('未知 sessionId 的 turn 结束被忽略', () => {
    const { record } = makeRecord('k1', 's1');
    const queue = new TurnQueue(makeManager([record]), noopLogger);
    expect(() => queue.onTurnEnd('other')).not.toThrow();
  });

  it('clear 后重新开始（busy 态被清除）', () => {
    const { record, followups } = makeRecord('k1', 's1');
    const queue = new TurnQueue(makeManager([record]), noopLogger);

    queue.dispatch(record, 'A');
    queue.dispatch(record, 'B'); // queued
    queue.clear('k1');
    expect(queue.dispatch(record, 'C')).toBe('sent');
    expect(followups).toEqual(['A', 'C']);
  });
});

describe('mergePending', () => {
  it('单条原样返回', () => {
    expect(mergePending(['only'])).toBe('only');
  });

  it('多条带编号合并', () => {
    const merged = mergePending(['a', 'b']);
    expect(merged).toContain('1. a');
    expect(merged).toContain('2. b');
  });
});
