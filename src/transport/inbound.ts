/**
 * 入站处理器 — 经 gateway/pipeline 过滤后的钉钉消息 → dsh Agent followup
 *
 * 内容组装分层：
 * - Layer 1: userContent（文本 + 语音识别 + 富文本 + 媒体描述）
 * - Layer 2: userMessage（群聊带发送者标签）
 *
 * 注：钉钉机器人回调拿不到未 @ 的群历史，也拿不到引用消息原文，
 * 因此没有 history / quote 层。
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { SessionManager } from '../session/index.js';
import type { ChatScope, Logger, ReplyTarget } from '../types.js';
import type { RobotInboundMessage } from '../dingtalk/types.js';

/** 从入站消息解析 scope + peerId + replyTarget（pipeline / inbound 共用） */
export function resolveScopePeer(msg: RobotInboundMessage): {
  scope: ChatScope;
  peerId: string;
  senderId: string;
  replyTarget: ReplyTarget;
} {
  const scope: ChatScope = msg.conversationType === '2' ? 'group' : 'direct';
  const senderId = msg.senderStaffId || msg.senderId;
  const peerId = scope === 'group' ? msg.conversationId : senderId;

  const replyTarget: ReplyTarget = {
    scope,
    targetId: scope === 'group' ? msg.conversationId : senderId,
    sessionWebhook: msg.sessionWebhook,
    sessionWebhookExpiredTime: msg.sessionWebhookExpiredTime,
    robotCode: msg.robotCode,
    msgId: msg.msgId,
  };

  return { scope, peerId, senderId, replyTarget };
}

/**
 * 处理钉钉入站消息（已经过 pipeline 去重/访问控制/命令分发）
 */
export async function handleInbound(
  msg: RobotInboundMessage,
  manager: SessionManager,
  logger: Logger,
): Promise<void> {
  const { scope, peerId, senderId, replyTarget } = resolveScopePeer(msg);

  const agentBody = assembleAgentBody(msg, scope);
  if (!agentBody) return;

  logger.info(`Processing: scope=${scope} peerId=${peerId} body="${agentBody.slice(0, 200)}"`);

  // ── 获取或创建会话 ──
  let record;
  try {
    record = await manager.getOrCreate(scope, peerId, senderId, replyTarget);
  } catch (err) {
    logger.error(`ERROR creating session: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // ── 构建 UserMessage → followup ──
  const content: ContentBlock[] = [{ type: 'text' as const, text: agentBody }];

  const message = createUserMessage({
    content,
    source: { kind: 'user' as const },
  });

  record.agent.followup(message);
  logger.info(`→ followup sent: key=${scope}:${peerId}`);
}

// ══════════════════════════════════════════════════════════════
// Body Assembly
// ══════════════════════════════════════════════════════════════

/**
 * 组装 agentBody — AI 实际看到的完整上下文
 */
export function assembleAgentBody(msg: RobotInboundMessage, scope: ChatScope): string | null {
  const userContent = buildUserContent(msg);
  if (!userContent) return null;

  if (scope !== 'group') return userContent;

  // 群聊：带发送者标签（群聊消息必然是 @bot 触发，无需 mention 标记）
  const displayName = msg.senderNick ?? shortSenderId(msg.senderId);
  const idTag = msg.senderStaffId ? ` (${msg.senderStaffId})` : '';
  return `[${displayName}${idTag}] ${userContent}`;
}

/**
 * Layer 1: 用户内容（按 msgtype 归一化为文本）
 */
function buildUserContent(msg: RobotInboundMessage): string {
  switch (msg.msgtype) {
    case 'text':
      return (msg.text?.content ?? '').trim();

    case 'richText': {
      const items = msg.content?.richText ?? [];
      const parts: string[] = [];
      let pictureCount = 0;
      for (const item of items) {
        if (item.text) {
          parts.push(item.text);
        } else if (item.type === 'picture' || item.downloadCode) {
          pictureCount += 1;
        }
      }
      const text = parts.join('').trim();
      const pictureTag = pictureCount > 0 ? `\n[消息中含 ${pictureCount} 张图片，暂不支持查看]` : '';
      return `${text}${pictureTag}`.trim();
    }

    case 'audio': {
      const recognition = (msg.content?.recognition ?? '').trim();
      if (!recognition) return '[语音消息，未识别出文本]';
      const duration = msg.content?.duration;
      const durationTag = duration ? ` (${Math.round(duration / 1000)}s)` : '';
      return `[语音消息${durationTag}] ${recognition}`;
    }

    case 'picture':
      return '[图片消息，暂不支持查看]';

    case 'video':
      return '[视频消息，暂不支持查看]';

    case 'file': {
      const fileName = msg.content?.fileName;
      return fileName ? `[文件消息: ${fileName}，暂不支持读取]` : '[文件消息，暂不支持读取]';
    }

    default:
      return '';
  }
}

/** 发送者短标识长度（加密 senderId 前 N 位，无昵称时兜底） */
const SENDER_SHORT_ID_LEN = 8;

/** 无昵称时用加密 senderId 前 N 位作为匿名标识 */
function shortSenderId(senderId: string): string {
  return senderId.slice(0, SENDER_SHORT_ID_LEN);
}
