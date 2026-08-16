/**
 * DingTalkMarkdownSender — 钉钉 markdown 消息发送
 *
 * 双通道：
 *   1. 首选 sessionWebhook（入站消息自带，免额外权限，自动路由回原会话）
 *   2. webhook 过期/失败时兜底机器人主动发送 OpenAPI（需 qyapi_robot_sendmsg 权限）：
 *      - 单聊: POST /v1.0/robot/oToMessages/batchSend
 *      - 群聊: POST /v1.0/robot/groupMessages/send
 */
import type { ImDingTalkConfig } from '../config.js';
import type { Logger, ReplyTarget } from '../types.js';
import type { DingTalkSender } from '../transport/outbound-buffer.js';
import type { OapiResponse, WebhookMarkdownBody } from './types.js';
import type { AccessTokenProvider } from './token.js';

const API_BASE = 'https://api.dingtalk.com';

/** webhook 过期安全边界：临期 15s 内直接走主动发送，避免边发边过期 */
const WEBHOOK_EXPIRY_MARGIN_MS = 15_000;

const HTTP_TIMEOUT_MS = 15_000;

/** sendMarkdown 的目标上下文（SessionRecord 子集） */
interface SendContext {
  replyTarget: ReplyTarget;
  scope: 'direct' | 'group';
  peerId: string;
  senderId: string;
}

export class DingTalkMarkdownSender implements DingTalkSender {
  constructor(
    private readonly config: ImDingTalkConfig,
    private readonly tokens: AccessTokenProvider,
    private readonly logger: Logger,
  ) {}

  async sendMarkdown(record: SendContext, content: string): Promise<void> {
    const target = record.replyTarget;

    if (this.webhookUsable(target)) {
      try {
        await this.sendViaWebhook(target.sessionWebhook!, content);
        return;
      } catch (err) {
        this.logger.warn(
          `im-dingtalk: sessionWebhook send failed, falling back to OpenAPI: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    await this.sendViaOpenApi(record, content);
  }

  /** webhook 是否可用（存在且未临期） */
  private webhookUsable(target: ReplyTarget): boolean {
    if (!target.sessionWebhook) return false;
    if (target.sessionWebhookExpiredTime === undefined) return true;
    return Date.now() < target.sessionWebhookExpiredTime - WEBHOOK_EXPIRY_MARGIN_MS;
  }

  private async sendViaWebhook(webhook: string, content: string): Promise<void> {
    const body: WebhookMarkdownBody = {
      msgtype: 'markdown',
      markdown: { title: this.config.markdownTitle, text: content },
    };

    const resp = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!resp.ok) {
      throw new Error(`sessionWebhook HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as OapiResponse;
    if (data.errcode !== 0) {
      throw new Error(`sessionWebhook errcode=${data.errcode} errmsg=${data.errmsg}`);
    }
  }

  private async sendViaOpenApi(record: SendContext, content: string): Promise<void> {
    const robotCode = record.replyTarget.robotCode || this.config.robotCode || this.config.clientId;
    const msgParam = JSON.stringify({ title: this.config.markdownTitle, text: content });

    if (record.scope === 'group') {
      await this.postApi('/v1.0/robot/groupMessages/send', {
        robotCode,
        openConversationId: record.replyTarget.targetId,
        msgKey: 'sampleMarkdown',
        msgParam,
      });
      return;
    }

    // 单聊主动发送需要 userId；跨企业场景 senderStaffId 缺失时无法兜底
    if (!record.senderId) {
      throw new Error('proactive send unavailable: missing senderStaffId (cross-corp sender?)');
    }
    await this.postApi('/v1.0/robot/oToMessages/batchSend', {
      robotCode,
      userIds: [record.senderId],
      msgKey: 'sampleMarkdown',
      msgParam,
    });
  }

  private async postApi(path: string, body: Record<string, unknown>): Promise<void> {
    const token = await this.tokens.get();
    const resp = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': token,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!resp.ok) {
      let detail = '';
      try {
        const err = (await resp.json()) as { code?: string; message?: string };
        detail = ` code=${err.code} message=${err.message}`;
      } catch {
        // 忽略响应体解析失败
      }
      throw new Error(`${path} HTTP ${resp.status}${detail}`);
    }
  }
}
