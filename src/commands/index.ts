/**
 * 斜杠命令注册中心
 *
 * 每个命令拆分为独立文件，此处仅编排：工厂函数注入依赖，统一导出命令列表。
 * 分发器见 dispatchSlashCommand：消息进入 agent 之前拦截 `/` 开头的文本。
 */
import type { SlashCommand, SlashCommandContext, CommandDeps } from './types.js';
import { resetCommand, newCommand } from './session.js';
import { modelCommand } from './model.js';
import { statusCommand } from './status.js';
import { helpCommand } from './help.js';
import { pingCommand, versionCommand, stopCommand } from './misc.js';

export type { SlashCommand, SlashCommandContext, CommandDeps } from './types.js';

/**
 * 构建标准命令列表
 */
export function buildCommandList(deps: CommandDeps): SlashCommand[] {
  const commands: SlashCommand[] = [
    // 会话
    resetCommand(deps),
    newCommand(deps),
    // 模型
    modelCommand(deps),
    // 状态
    statusCommand(deps),
    // 杂项
    pingCommand(),
    versionCommand(deps),
    stopCommand(deps),
  ];

  // help 需要访问完整列表（含自身），通过闭包惰性引用
  commands.push(helpCommand(deps, () => commands));

  return commands;
}

/**
 * 尝试将消息文本作为斜杠命令分发
 *
 * @returns true 表示已被命令消费（不再进入 agent）
 */
export async function dispatchSlashCommand(
  text: string,
  commands: SlashCommand[],
  cmdCtx: Omit<SlashCommandContext, 'args'>,
): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return false;

  const [head = '', ...rest] = trimmed.slice(1).split(/\s+/);
  const command = commands.find((cmd) => {
    const names = Array.isArray(cmd.name) ? cmd.name : [cmd.name];
    return names.includes(head);
  });
  if (!command) return false;

  const result = await command.handler({ ...cmdCtx, args: rest.join(' ').trim() });
  if (typeof result === 'string' && result) {
    await cmdCtx.reply(result);
  }
  return true;
}
