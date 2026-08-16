/**
 * 钉钉机器人入站消息 / API 类型定义
 *
 * 字段依据开放平台文档「机器人接收消息」「消息发送与接收类型」：
 * https://open.dingtalk.com/document/dingstart/robot-receive-message
 * https://open.dingtalk.com/document/development/robot-message-type
 */

/** 被 @ 的用户 */
export interface AtUser {
  dingtalkId: string;
  /** 企业内部群中为用户 userId；机器人自身无此字段 */
  staffId?: string;
}

/** 富文本片段（text 与 picture 混排） */
export interface RichTextItem {
  text?: string;
  downloadCode?: string;
  type?: string;
}

/**
 * 机器人入站消息（Stream 回调 data 反序列化结果）
 *
 * 除 msgtype/消息体外，其余字段单聊、群聊通用；
 * conversationTitle/atUsers/isInAtList 仅群聊存在。
 */
export interface RobotInboundMessage {
  conversationId: string;
  chatbotCorpId?: string;
  chatbotUserId?: string;
  msgId: string;
  senderNick?: string;
  isAdmin?: boolean;
  /** 企业内部场景为发送者 userId（主动发送兜底用） */
  senderStaffId?: string;
  sessionWebhookExpiredTime: number;
  createAt: number;
  senderCorpId?: string;
  /** 会话类型：'1' 单聊，'2' 群聊 */
  conversationType: string;
  /** 加密的发送者 ID（跨企业场景 senderStaffId 缺失时的兜底标识） */
  senderId: string;
  conversationTitle?: string;
  isInAtList?: boolean;
  atUsers?: AtUser[];
  sessionWebhook: string;
  robotCode?: string;
  msgtype: string;
  /** msgtype = text */
  text?: { content?: string };
  /** msgtype = richText/picture/audio/video/file 的消息体 */
  content?: {
    richText?: RichTextItem[];
    downloadCode?: string;
    /** 语音识别文本 */
    recognition?: string;
    /** 语音/视频时长（毫秒） */
    duration?: number;
    videoType?: string;
    fileName?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** sessionWebhook / 自定义机器人消息体（markdown） */
export interface WebhookMarkdownBody {
  msgtype: 'markdown';
  markdown: {
    title: string;
    text: string;
  };
  at?: {
    atUserIds?: string[];
    isAtAll?: boolean;
  };
}

/** oapi webhook 响应体 */
export interface OapiResponse {
  errcode: number;
  errmsg: string;
}
