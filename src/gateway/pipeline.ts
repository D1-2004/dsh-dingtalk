/**
 * 入站管线 — 消息进入 agent 之前的过滤与分发
 *
 * 钉钉 Stream SDK 不带消息中间件设施，这里内联实现插件需要的最小集：
 *   1. msgId 去重（Stream 服务端对未 ack 消息会重推）
 *   2. 访问控制（open / allowlist / disabled）
 *   3. 斜杠命令分发
 *
 * 钉钉群聊机器人只会收到 @ 它的消息，因此无需额外的 @ 门控。
 */
import type { ImDingTalkConfig } from '../config.js';
import type { Logger } from '../types.js';
import type { SessionManager } from '../session/index.js';
import type { RobotInboundMessage } from '../dingtalk/types.js';
import type { DingTalkSender } from '../transport/outbound-buffer.js';
import { chunkMarkdownText } from '../transport/chunker.js';
import { resolveScopePeer } from '../transport/inbound.js';
import { buildCommandList, dispatchSlashCommand, type SlashCommand } from '../commands/index.js';

/** msgId 去重窗口大小 */
const DEDUP_CAPACITY = 2048;

export class InboundPipeline {
  private readonly commands: SlashCommand[];
  private readonly seenMsgIds = new Set<string>();

  constructor(
    private readonly config: ImDingTalkConfig,
    manager: SessionManager,
    private readonly sender: DingTalkSender,
    private readonly logger: Logger,
  ) {
    this.commands = buildCommandList({ manager, config });
  }

  /**
   * 处理入站消息
   *
   * @returns true 表示应继续进入 agent；false 表示已被管线消费/拦截
   */
  async process(msg: RobotInboundMessage): Promise<boolean> {
    // 1. msgId 去重
    if (msg.msgId) {
      if (this.seenMsgIds.has(msg.msgId)) {
        this.logger.debug(`im-dingtalk: duplicate msgId dropped: ${msg.msgId}`);
        return false;
      }
      this.remember(msg.msgId);
    }

    const { scope, peerId, senderId, replyTarget } = resolveScopePeer(msg);

    // 2. 访问控制
    const access = this.config.access;
    const mode = scope === 'group' ? access.groupMode : access.directMode;
    const allow = scope === 'group' ? access.groupAllow : access.directAllow;
    const subject = scope === 'group' ? msg.conversationId : senderId;

    if (mode === 'disabled') {
      this.logger.debug(`im-dingtalk: access blocked (${scope} disabled)`);
      return false;
    }
    if (mode === 'allowlist' && !allow.includes(subject) && !allow.includes('*')) {
      this.logger.debug(`im-dingtalk: access blocked (${scope} allowlist): ${subject}`);
      return false;
    }

    // 3. 斜杠命令
    const text = msg.msgtype === 'text' ? (msg.text?.content ?? '').trim() : '';
    if (text.startsWith('/')) {
      const sendContext = { replyTarget, scope, peerId, senderId };
      const consumed = await dispatchSlashCommand(text, this.commands, {
        scope,
        peerId,
        senderId,
        reply: async (content: string) => {
          for (const chunk of chunkMarkdownText(content, this.config.textChunkLimit)) {
            await this.sender.sendMarkdown(sendContext, chunk);
          }
        },
      });
      if (consumed) {
        this.logger.info(`im-dingtalk: slash command handled: ${text.split(/\s+/)[0]}`);
        return false;
      }
    }

    return true;
  }

  /** 记录 msgId，超出容量时淘汰最早的（Set 迭代序 = 插入序） */
  private remember(msgId: string): void {
    this.seenMsgIds.add(msgId);
    if (this.seenMsgIds.size > DEDUP_CAPACITY) {
      const oldest = this.seenMsgIds.values().next().value;
      if (oldest !== undefined) this.seenMsgIds.delete(oldest);
    }
  }
}
