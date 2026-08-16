/**
 * 网关组装 — 创建 Stream 客户端、编排入站管线、注册出站、生命周期
 *
 * 将钉钉消息平台作为 dsh 前端协议驱动：入站消息 → pipeline → handleInbound → dsh agent，
 * dsh session/event → createOutboundHandler → 钉钉出站。
 */
import type { Context } from '@deepseek-ai/cordis';
import { DWClient, TOPIC_ROBOT, type DWClientDownStream } from 'dingtalk-stream';
import { SessionManager, type DshAgentRegistry } from '../session/index.js';
import { handleInbound, createOutboundHandler } from '../transport/index.js';
import { TurnQueue } from '../transport/turn-queue.js';
import type { ToolsRegistryLike } from '../transport/tool-presenter.js';
import { AccessTokenProvider } from '../dingtalk/token.js';
import { DingTalkMarkdownSender } from '../dingtalk/sender.js';
import type { RobotInboundMessage } from '../dingtalk/types.js';
import { buildUserAgent } from '../shared/index.js';
import type { ImDingTalkConfig } from '../config.js';
import type { Logger } from '../types.js';
import { InboundPipeline } from './pipeline.js';
import { InstanceLock } from './instance-lock.js';

export async function bootstrapGateway(
  ctx: Context,
  agents: DshAgentRegistry,
  config: ImDingTalkConfig,
  logger: Logger,
): Promise<void> {
  // ── 单实例锁：同 clientId 多实例会被钉钉负载均衡分流消息 ──
  const lock = new InstanceLock(config.clientId);
  if (!lock.acquire(logger)) {
    logger.error('im-dingtalk: 已有同 clientId 实例在运行（多实例会导致消息被随机分流），本实例不启动');
    return;
  }

  const manager = new SessionManager(ctx, agents, config, logger);
  const turnQueue = new TurnQueue(manager, logger);
  manager.onSessionRemoved = (key) => turnQueue.clear(key);

  // ── 钉钉接入组件 ──
  const tokens = new AccessTokenProvider(config.clientId, config.clientSecret, logger);
  const sender = new DingTalkMarkdownSender(config, tokens, logger);
  const pipeline = new InboundPipeline(config, manager, sender, logger);

  const userAgent = buildUserAgent();
  const client = new DWClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    ua: userAgent,
    keepAlive: true,
    debug: config.debug,
  });
  logger.info(`DingTalk Stream client initialized (UA: ${userAgent})`);

  // ── 入站：机器人消息回调 → pipeline → dsh agent ──
  client.registerCallbackListener(TOPIC_ROBOT, async (res: DWClientDownStream) => {
    // 先 ack：Stream 服务端对未响应消息会在 60s 内重推，
    // 而 agent 处理耗时可达分钟级，必须收到即 ack、异步处理。
    client.socketCallBackResponse(res.headers.messageId, { success: true });

    let msg: RobotInboundMessage;
    try {
      msg = JSON.parse(res.data) as RobotInboundMessage;
    } catch (err) {
      logger.error(`im-dingtalk: malformed inbound payload: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    if (config.debug) {
      logger.debug(`← message: ${JSON.stringify(msg).slice(0, 500)}`);
    }

    try {
      const proceed = await pipeline.process(msg);
      if (proceed) {
        await handleInbound(msg, manager, turnQueue, logger);
      }
    } catch (err) {
      logger.error(`im-dingtalk: inbound handling failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // ── 出站：dsh session/event → 钉钉消息 ──
  // 获取 tools 服务（工具结果结构化展示，参考 dsh-TUI presentResult），可选
  let toolsRegistry: ToolsRegistryLike | undefined;
  try {
    toolsRegistry = ctx.get('tools') as ToolsRegistryLike | undefined;
  } catch {
    toolsRegistry = undefined;
  }

  const outboundHandler = createOutboundHandler(manager, sender, config, logger, toolsRegistry);
  const ctxEvents = ctx as unknown as { on(event: string, handler: (...args: unknown[]) => void): void };
  ctxEvents.on('session/event', outboundHandler as (...args: unknown[]) => void);

  // turn/end → 释放 TurnQueue 的 busy 态并投递合并后的 pending
  ctxEvents.on('session/event', ((session: { header: { id: string } }, event: { type?: string }) => {
    if (event?.type === 'turn/end') {
      turnQueue.onTurnEnd(session.header.id);
    }
  }) as unknown as (...args: unknown[]) => void);

  // ── 生命周期 ──
  (ctx as unknown as { effect(fn: () => (() => Promise<void>) | void, name?: string): void })
    .effect(() => {
      logger.info(`Starting DingTalk Stream connection (clientId=${config.clientId})`);
      client.connect().then(() => {
        console.log(`[im-dingtalk] Stream connected! clientId=${config.clientId}`);
      }).catch((err: unknown) => {
        // DWClient 内置指数退避自动重连，这里只记录首连失败
        logger.error(`Stream connect failed: ${err instanceof Error ? err.message : String(err)}`);
      });

      return async () => {
        logger.info('Shutting down');
        await manager.disposeAll();
        client.disconnect();
        lock.release();
      };
    }, 'im-dingtalk.lifecycle');
}
