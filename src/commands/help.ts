/**
 * /bot-help — 查看所有指令以及用途
 *
 * 遍历所有非隐藏命令，以 Markdown 列表发送。
 */
import type { SlashCommand, CommandDeps } from './types.js';
import { PLUGIN_VERSION } from '../shared/index.js';

/** /bot-help — 查看所有指令以及用途 */
export function helpCommand(_deps: CommandDeps, allCommands: () => SlashCommand[]): SlashCommand {
  return {
    name: 'bot-help',
    description: '查看所有指令以及用途',
    handler: async (cmdCtx) => {
      const lines = ['### 钉钉机器人内置指令', ''];

      for (const cmd of allCommands()) {
        const name = Array.isArray(cmd.name) ? cmd.name[0] : cmd.name;
        if (cmd.hidden) continue;
        lines.push(`- \`/${name}\` ${cmd.description ?? ''}`);
      }

      lines.push('', `> dsh-dingtalk v${PLUGIN_VERSION}`);
      await cmdCtx.reply(lines.join('\n'));
    },
  };
}
