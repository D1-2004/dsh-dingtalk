/**
 * 模型命令：/bot-model — 查看或切换模型
 */
import type { SlashCommand, CommandDeps } from './types.js';

export function modelCommand({ manager }: CommandDeps): SlashCommand {
  return {
    name: 'bot-model',
    description: '查看或切换模型（用法: /bot-model [provider/model]）',
    handler: async (cmdCtx) => {
      const { scope, peerId, args } = cmdCtx;

      // 无参数：显示当前模型 + 可用模型列表
      if (!args) {
        const current = manager.getEffectiveModel(scope, peerId);
        const models = manager.listAvailableModels();

        // 当前模型展示：优先用别名（name），找不到别名时回退到 provider/model id
        let currentDisplay = '宿主默认配置';
        if (current) {
          const matched = models.find((m) => m.provider === current.provider && m.id === current.model);
          currentDisplay = matched?.name ?? `${current.provider}/${current.model}`;
        }

        const lines: string[] = [
          '### 🤖 模型配置',
          '',
          `**当前模型:** ${currentDisplay}`,
        ];

        if (models.length > 0) {
          lines.push('', '**可用模型:**');
          for (const m of models) {
            const modelPath = `${m.provider}/${m.id}`;
            const alias = m.name ? `（${m.name}）` : '';
            lines.push(`- \`/bot-model ${modelPath}\`${alias}`);
          }
        }

        lines.push('', '手动指定: `/bot-model provider/model`');

        await cmdCtx.reply(lines.join('\n'));
        return;
      }

      // 解析 provider/model 格式
      let provider: string;
      let model: string;

      if (args.includes('/')) {
        const parts = args.split('/');
        provider = parts[0] ?? '';
        model = parts.slice(1).join('/');
      } else {
        // 仅指定 model 名，provider 从当前路由继承
        const current = manager.getEffectiveModel(scope, peerId);
        provider = current?.provider ?? 'deepseek-official';
        model = args;
      }

      if (!provider || !model) {
        return '用法: /bot-model provider/model\n示例: /bot-model deepseek-official/deepseek-v4-flash';
      }

      await manager.setModelOverride(scope, peerId, { provider, model });
      return `✅ 模型已切换: ${provider}/${model}\n立即生效，对话上下文保留。`;
    },
  };
}
