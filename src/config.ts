/**
 * dsh-im-dingtalk 插件配置 Schema
 */
import Schema from '@deepseek-ai/schemastery';

export interface AccessControlConfig {
  /** 单聊访问模式 */
  directMode: 'open' | 'allowlist' | 'disabled';
  /** 单聊白名单（senderStaffId） */
  directAllow: string[];
  /** 群聊访问模式 */
  groupMode: 'open' | 'allowlist' | 'disabled';
  /** 群聊白名单（openConversationId） */
  groupAllow: string[];
}

export interface ImDingTalkConfig {
  /** 钉钉应用 Client ID（即 AppKey） */
  clientId: string;
  /** 钉钉应用 Client Secret（即 AppSecret） */
  clientSecret: string;
  /**
   * 机器人编码（主动发送兜底用）。
   * 企业内部应用机器人通常与 Client ID 相同，留空时回落到 clientId。
   */
  robotCode?: string;
  /**
   * 开放平台统一应用 ID（可选）。
   * 凭据未配置时，dws 引导会用它调 `dws dev app credentials get` 自动取凭证。
   */
  unifiedAppId?: string;
  /** dsh LLM 提供商名称 */
  provider?: string;
  /** 模型名称 */
  model?: string;
  /** Agent preset id */
  preset?: string;
  /** Agent 工作目录（缺省回落到进程 cwd） */
  cwd?: string;
  /** markdown 消息标题（显示在会话列表/推送通知里） */
  markdownTitle: string;
  /** 单条消息最大长度（钉钉 markdown 消息限制，保守取 4000） */
  textChunkLimit: number;
  /** 每会话最大闲置时长(ms)，超时自动回收 */
  sessionIdleTimeout: number;
  /** 访问控制 */
  access: AccessControlConfig;
  /** 是否展示工具调用成功结果（工具错误始终展示） */
  showToolResults: boolean;
  /** 调试模式 */
  debug: boolean;
}

export const ConfigSchema: Schema<ImDingTalkConfig> = Schema.object({
  clientId: Schema.string().default('').description('钉钉应用 Client ID（AppKey）'),
  clientSecret: Schema.string().default('').description('钉钉应用 Client Secret（AppSecret）'),
  robotCode: Schema.string().description('机器人编码（留空回落到 clientId）'),
  unifiedAppId: Schema.string().description('统一应用 ID（dws 引导取凭证用）'),
  provider: Schema.string().description('LLM provider name'),
  model: Schema.string().description('Model name'),
  preset: Schema.string().description('Agent preset id'),
  cwd: Schema.string().description('Agent working directory'),
  markdownTitle: Schema.string().default('AI 助手').description('markdown 消息标题'),
  textChunkLimit: Schema.number().default(4000).description('单条消息最大字符数'),
  sessionIdleTimeout: Schema.number().default(30 * 60 * 1000).description('会话闲置超时(ms)'),
  access: Schema.object({
    directMode: Schema.union(['open', 'allowlist', 'disabled']).default('open').description('单聊访问模式'),
    directAllow: Schema.array(Schema.string()).default([]).description('单聊白名单'),
    groupMode: Schema.union(['open', 'allowlist', 'disabled']).default('open').description('群聊访问模式'),
    groupAllow: Schema.array(Schema.string()).default([]).description('群聊白名单'),
  }).default({
    directMode: 'open',
    directAllow: [],
    groupMode: 'open',
    groupAllow: [],
  }).description('访问控制'),
  showToolResults: Schema.boolean().default(false).description('是否展示工具调用成功结果（错误始终展示）'),
  debug: Schema.boolean().default(false),
});
