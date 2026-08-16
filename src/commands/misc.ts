/**
 * 杂项命令：/bot-ping /bot-version /bot-stop
 */
import type { SlashCommand, CommandDeps } from './types.js';
import { PLUGIN_VERSION } from '../shared/index.js';

/** /bot-ping — 连通性测试 */
export function pingCommand(): SlashCommand {
  return {
    name: 'bot-ping',
    description: '连通性测试',
    handler: () => 'pong 🏓',
  };
}

/** /bot-version — 查看版本信息 */
export function versionCommand({ manager }: CommandDeps): SlashCommand {
  return {
    name: 'bot-version',
    description: '查看版本信息',
    handler: (cmdCtx) => {
      const current = manager.getEffectiveModel(cmdCtx.scope, cmdCtx.peerId);
      const modelInfo = current ? `${current.provider}/${current.model}` : '宿主默认';
      return `dsh-dingtalk v${PLUGIN_VERSION} | model: ${modelInfo}`;
    },
  };
}

/** /bot-stop — 中止当前生成 */
export function stopCommand({ manager }: CommandDeps): SlashCommand {
  return {
    name: 'bot-stop',
    description: '中止当前生成',
    handler: (cmdCtx) => {
      const record = manager.getSessionRecord(cmdCtx.scope, cmdCtx.peerId);
      if (!record) return '当前无活跃会话';
      record.agent.cancel({ kind: 'user' });
      return '已请求中止当前生成 ⏹';
    },
  };
}
