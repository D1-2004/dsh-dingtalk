/**
 * InstanceLock — 同 clientId 单实例锁
 *
 * 钉钉会把同一 clientId 的多条 Stream 连接做负载均衡分流，
 * 两个实例同时在线时消息被随机拆分，表现为「机器人时灵时不灵」，
 * 极难排查。用 pid 锁文件保证同 clientId 同机只有一个实例；
 * 陈旧锁（持有进程已死）自动接管。
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import type { Logger } from '../types.js';

export class InstanceLock {
  private readonly path: string;
  private held = false;

  constructor(clientId: string) {
    // clientId 参与文件名前做字符净化，避免特殊字符影响路径
    const safeId = clientId.replace(/[^a-zA-Z0-9._-]/g, '_');
    this.path = join(os.tmpdir(), `dsh-dingtalk-${safeId}.pid`);
  }

  /**
   * 尝试获得锁
   *
   * @returns false 表示已有存活实例持有该 clientId，调用方应拒绝启动；
   *          锁文件操作本身失败时降级为无锁放行（不因锁机制阻断主流程）
   */
  acquire(logger: Logger): boolean {
    try {
      if (existsSync(this.path)) {
        const pid = Number(readFileSync(this.path, 'utf8').trim());
        if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && isProcessAlive(pid)) {
          logger.error(`im-dingtalk: another instance (pid=${pid}) already holds ${this.path}`);
          return false;
        }
        if (pid && pid !== process.pid) {
          logger.warn(`im-dingtalk: taking over stale instance lock (dead pid=${pid})`);
        }
      }
      writeFileSync(this.path, String(process.pid), 'utf8');
      this.held = true;
      return true;
    } catch (err) {
      logger.warn(`im-dingtalk: instance lock unavailable, continuing without it: ${err instanceof Error ? err.message : String(err)}`);
      return true;
    }
  }

  /** 释放锁（仅删除自己持有的锁文件） */
  release(): void {
    if (!this.held) return;
    this.held = false;
    try {
      unlinkSync(this.path);
    } catch {
      // 文件已被清理，忽略
    }
  }
}

/** 进程是否存活（EPERM 表示存在但无权限发信号，也算存活） */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
