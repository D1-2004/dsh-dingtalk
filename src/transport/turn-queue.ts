/**
 * TurnQueue — 同会话串行投递 + 突发合并
 *
 * 同一会话在 agent 处理期间收到的新消息不立即投递（避免中途 steering
 * 污染当前轮），而是堆积成 pending 批；当前 turn 结束后整批合并成
 * 一个后续请求投递，让 agent 面对的是"最新的完整诉求"而不是一串过时的中间问题。
 *
 * 斜杠命令在 gateway/pipeline 已被拦截，不会进入本队列。
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { SessionManager, SessionRecord } from '../session/index.js';
import type { Logger } from '../types.js';

/** busy 状态的保险过期时长：turn/end 意外丢失时避免会话永久卡死 */
const STALE_BUSY_MS = 10 * 60 * 1000;

interface TurnState {
  busy: boolean;
  busySince: number;
  pending: string[];
}

export class TurnQueue {
  private readonly states = new Map<string, TurnState>();

  constructor(
    private readonly manager: SessionManager,
    private readonly logger: Logger,
  ) {}

  /** 投递消息体：空闲立即 followup，busy 则入队等待合并 */
  dispatch(record: SessionRecord, body: string): 'sent' | 'queued' {
    const state = this.stateFor(record.sessionKey);
    if (state.busy && Date.now() - state.busySince < STALE_BUSY_MS) {
      state.pending.push(body);
      this.logger.info(`im-dingtalk: turn busy, message queued (pending=${state.pending.length}) key=${record.sessionKey}`);
      return 'queued';
    }
    this.send(record, body, state);
    return 'sent';
  }

  /** turn 结束回调：有 pending 则合并投递（保持 busy），否则转入空闲 */
  onTurnEnd(sessionId: string): void {
    const record = this.manager.findBySessionId(sessionId);
    if (!record) return;
    const state = this.states.get(record.sessionKey);
    if (!state) return;

    if (state.pending.length === 0) {
      state.busy = false;
      return;
    }
    const body = mergePending(state.pending.splice(0, state.pending.length));
    this.logger.info(`im-dingtalk: turn ended with pending, dispatching merged followup key=${record.sessionKey}`);
    this.send(record, body, state);
  }

  /** 会话被重置/回收时清理状态 */
  clear(sessionKey: string): void {
    this.states.delete(sessionKey);
  }

  private send(record: SessionRecord, body: string, state: TurnState): void {
    state.busy = true;
    state.busySince = Date.now();

    const content: ContentBlock[] = [{ type: 'text' as const, text: body }];
    record.agent.followup(createUserMessage({
      content,
      source: { kind: 'user' as const },
    }));
  }

  private stateFor(key: string): TurnState {
    let state = this.states.get(key);
    if (!state) {
      state = { busy: false, busySince: 0, pending: [] };
      this.states.set(key, state);
    }
    return state;
  }
}

/** 把突发的多条消息合并成一个请求体 */
export function mergePending(bodies: string[]): string {
  const first = bodies[0] ?? '';
  if (bodies.length <= 1) return first;

  const lines = ['用户在上一轮处理期间连续发送了以下消息，请把它们作为同一个最新请求一起处理：'];
  bodies.forEach((body, index) => {
    lines.push(`${index + 1}. ${body}`);
  });
  return lines.join('\n');
}
