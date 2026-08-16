/**
 * dsh-im-dingtalk 插件内部类型定义
 */

/** 会话作用域：direct = 单聊，group = 群聊 */
export type ChatScope = 'direct' | 'group';

/**
 * 钉钉回复目标
 *
 * 首选 sessionWebhook（免额外权限、自动路由回原会话），
 * 过期后由 sender 兜底走机器人主动发送 OpenAPI（需要 robotCode）。
 */
export interface ReplyTarget {
  scope: ChatScope;
  /** direct: senderStaffId；group: openConversationId */
  targetId: string;
  /** 入站消息附带的回复 webhook */
  sessionWebhook?: string;
  /** sessionWebhook 过期时间（毫秒时间戳） */
  sessionWebhookExpiredTime?: number;
  /** 机器人编码（主动发送兜底用） */
  robotCode?: string;
  /** 原始消息 ID */
  msgId?: string;
}

/** 插件 Logger 接口 */
export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}
