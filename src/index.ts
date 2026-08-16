/**
 * dsh-im-dingtalk — 钉钉机器人 IM channel plugin for deepseek-harness
 *
 * Cordis 插件入口。将钉钉消息平台作为 dsh 的前端协议驱动。
 * 网关组装（Stream 客户端 + 入站管线 + 出站 + 生命周期）见 src/gateway/。
 */
import type { Context } from '@deepseek-ai/cordis';
import { ConfigSchema, type ImDingTalkConfig } from './config.js';
import { bootstrapGateway } from './gateway/index.js';
import type { DshAgentRegistry } from './session/index.js';
import { PLUGIN_ROOT, resolveEnv } from './shared/index.js';
import { runDwsSetup, persistCredentialsToProfile, getProfileDir } from './setup.js';
import type { Logger } from './types.js';

// ── Cordis 插件元数据 ──
export const name = 'im-dingtalk';
export const inject = ['agents'];
export const Config = ConfigSchema;

export type { ImDingTalkConfig } from './config.js';

// ── 插件主体 ──
export async function apply(ctx: Context, config: ImDingTalkConfig): Promise<void> {
  const agents = (ctx as unknown as Record<string, unknown>).agents as DshAgentRegistry;
  const logger: Logger = ((ctx as unknown as Record<string, unknown>).logger as Logger) ?? console;

  console.log('[im-dingtalk] apply() called');

  let clientId = resolveEnv(config.clientId, 'DINGTALK_CLIENT_ID');
  let clientSecret = resolveEnv(config.clientSecret, 'DINGTALK_CLIENT_SECRET');
  let robotCode = resolveEnv(config.robotCode ?? '', 'DINGTALK_ROBOT_CODE');

  // ── 凭据缺失时唤起 dws 引导（浏览器/扫码授权 → 取凭证/建号） ──
  if (!clientId || !clientSecret) {
    logger.info('凭据未配置，尝试 dws 引导...');
    const credentials = await runDwsSetup(config.unifiedAppId, logger);

    if (!credentials) {
      logger.error('无法获取钉钉机器人凭据，插件未启动');
      return;
    }

    // 写入环境变量（供热更新后的下次 apply 或本次直接启动读取）
    process.env.DINGTALK_CLIENT_ID = credentials.clientId;
    process.env.DINGTALK_CLIENT_SECRET = credentials.clientSecret;
    if (credentials.robotCode) {
      process.env.DINGTALK_ROBOT_CODE = credentials.robotCode;
    }
    clientId = credentials.clientId;
    clientSecret = credentials.clientSecret;
    robotCode = credentials.robotCode ?? robotCode;

    // 持久化到 profile：成功则等待热更新重载，失败则用 env 凭据直接启动
    const persisted = persistCredentialsToProfile(credentials, getProfileDir(PLUGIN_ROOT) ?? undefined, logger);
    if (persisted) {
      // 写入 cordis.patch.yml 会触发 dsh 热更新，自动重新加载本插件。
      // 直接返回，避免与热更新产生竞态。
      logger.info('配置已保存，等待热更新重新加载...');
      return;
    }
    logger.warn('凭据未能持久化，本次进程将使用环境变量凭据启动（重启后需重新引导）');
  }

  const resolvedConfig: ImDingTalkConfig = {
    ...config,
    clientId,
    clientSecret,
    robotCode: robotCode || undefined,
  };

  await bootstrapGateway(ctx, agents, resolvedConfig, logger);
}
