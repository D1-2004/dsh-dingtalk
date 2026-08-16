/**
 * OutboundBuffer — 出站文本缓冲
 *
 * 收集流式 chunk，在 assistant/message 或 turn/end 时整体发送。
 *
 * 钉钉 IM 消息没有「编辑已发送消息」的流式通道
 * （AI 卡片流式属于另一套卡片体系，不在本插件范围），
 * 因此这里不做逐字流式，只做完整缓冲后分块发送。
 */
import type { SessionRecord } from '../session/index.js';
import type { Logger } from '../types.js';
import { chunkMarkdownText } from './chunker.js';

/** 钉钉发送接口（sender 实现见 dingtalk/sender.ts） */
export interface DingTalkSender {
  sendMarkdown(record: Pick<SessionRecord, 'replyTarget' | 'scope' | 'peerId' | 'senderId'>, content: string): Promise<unknown>;
}

export class OutboundBuffer {
  private buffer = '';
  private flushing = false;

  public constructor(
    private readonly record: SessionRecord,
    private readonly sender: DingTalkSender,
    private readonly limit: number,
    private readonly logger: Logger,
  ) {}

  /** 追加文本增量 */
  public append(text: string): void {
    this.buffer += text;
  }

  /** 获取当前累积文本 */
  public get text(): string {
    return this.buffer;
  }

  /** 发送所有累积文本（分块） */
  public async flush(): Promise<void> {
    if (this.flushing || !this.buffer.trim()) return;
    this.flushing = true;

    try {
      const chunks = chunkMarkdownText(this.buffer, this.limit);
      for (const chunk of chunks) {
        await this.sender.sendMarkdown(this.record, chunk);
      }
    } catch (err) {
      this.logger.error(`im-dingtalk: flush failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.buffer = '';
      this.flushing = false;
    }
  }

  /** 取消（异常/丢弃），清空缓冲 */
  public cancel(): void {
    this.buffer = '';
  }
}
