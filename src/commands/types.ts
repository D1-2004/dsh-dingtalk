/**
 * 斜杠命令类型定义
 *
 * 钉钉侧没有 SDK 内置的命令中间件，插件自带一套轻量命令模型：
 * gateway/pipeline 在消息进入 agent 之前拦截 `/` 开头的文本并分发。
 */
import type { ChatScope } from '../types.js';
import type { SessionManager } from '../session/index.js';
import type { ImDingTalkConfig } from '../config.js';

/** 命令执行上下文 */
export interface SlashCommandContext {
  scope: ChatScope;
  peerId: string;
  senderId: string;
  /** 命令名之后的原始参数字符串（已 trim） */
  args: string;
  /** 发送 markdown 回复（长内容自动切分） */
  reply(content: string): Promise<void>;
}

/** 斜杠命令定义 */
export interface SlashCommand {
  /** 命令名（可带别名数组），不含前导 `/` */
  name: string | string[];
  description?: string;
  /** 隐藏命令不出现在 /bot-help 列表 */
  hidden?: boolean;
  /** 返回 string 时由分发器代发；返回 void 表示 handler 已自行回复 */
  handler(cmdCtx: SlashCommandContext): Promise<string | void> | string | void;
}

/**
 * 命令依赖
 *
 * 每个命令工厂函数接收 CommandDeps，由 commands/index.ts 统一注入。
 */
export interface CommandDeps {
  manager: SessionManager;
  config: ImDingTalkConfig;
}
