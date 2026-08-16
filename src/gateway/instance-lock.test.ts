import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { InstanceLock } from './instance-lock.js';
import type { Logger } from '../types.js';

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const CLIENT_ID = `test-lock-${process.pid}`;
const LOCK_PATH = join(os.tmpdir(), `dsh-dingtalk-${CLIENT_ID}.pid`);

afterEach(() => {
  if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH);
});

describe('InstanceLock', () => {
  it('无锁文件时获得锁并写入自身 pid', () => {
    const lock = new InstanceLock(CLIENT_ID);
    expect(lock.acquire(noopLogger)).toBe(true);
    expect(readFileSync(LOCK_PATH, 'utf8')).toBe(String(process.pid));
    lock.release();
    expect(existsSync(LOCK_PATH)).toBe(false);
  });

  it('陈旧锁（pid 已死）自动接管', () => {
    // 选一个极大的、几乎不可能存在的 pid
    writeFileSync(LOCK_PATH, '999999999', 'utf8');
    const lock = new InstanceLock(CLIENT_ID);
    expect(lock.acquire(noopLogger)).toBe(true);
    expect(readFileSync(LOCK_PATH, 'utf8')).toBe(String(process.pid));
    lock.release();
  });

  it('存活进程持锁时拒绝启动', () => {
    // 用当前测试进程之外一定存活的 pid：父进程
    const alivePid = process.ppid;
    writeFileSync(LOCK_PATH, String(alivePid), 'utf8');
    const lock = new InstanceLock(CLIENT_ID);
    expect(lock.acquire(noopLogger)).toBe(false);
    // 未持有锁，release 不应删除他人的锁文件
    lock.release();
    expect(existsSync(LOCK_PATH)).toBe(true);
  });

  it('锁文件里是自己的 pid 时可重入', () => {
    writeFileSync(LOCK_PATH, String(process.pid), 'utf8');
    const lock = new InstanceLock(CLIENT_ID);
    expect(lock.acquire(noopLogger)).toBe(true);
    lock.release();
  });
});
