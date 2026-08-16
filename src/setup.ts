/**
 * 钉钉机器人凭据初始化 — dws 引导
 *
 * 当 clientId/clientSecret 未配置时，尝试借助本机 dws CLI 获取凭据：
 *
 *   1. `dws auth login` — 浏览器 / 钉钉扫码授权（未登录时引导）
 *   2. 凭据来源（按优先级）：
 *      a. 指定统一应用：`dws dev app credentials get --unified-app-id <ID>`
 *         （通过配置 unifiedAppId 或环境变量 DINGTALK_UNIFIED_APP_ID 指定）
 *      b. 自动建号（需显式开启 DSH_DINGTALK_AUTO_CREATE=1）：
 *         `dws dev app robot submit` 提交创建任务 → `robot result` 轮询拿凭据
 *   3. 凭据写入 dsh profile 的 cordis.patch.yml，触发热更新自动重载
 *
 * 本机没有 dws 或未开启任何来源时，打印环境变量配置指引后返回 null。
 */
import { resolve } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import type { Logger } from './types.js';

/** 凭据结果 */
export interface SetupCredentials {
  clientId: string;
  clientSecret: string;
  robotCode?: string;
}

/** cordis.patch.yml 中的 patch 条目 */
interface PatchEntry {
  id?: string;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * dws 输出结构
 *
 * dev 命令族输出 {ok, outcome, data} 信封；auth 命令族输出扁平结构
 * （如 auth status 直接给 {success, authenticated, ...}），两种都要兼容。
 */
type DwsOutput = Record<string, unknown>;

/** 建号轮询参数 */
const CREATE_POLL_INTERVAL_MS = 3_000;
const CREATE_POLL_MAX_ATTEMPTS = 40;

const DWS_TIMEOUT_MS = 60_000;

// ══════════════════════════════════════════════════════════════
// dws 调用
// ══════════════════════════════════════════════════════════════

/** 运行 dws 子命令并解析 JSON 输出，失败返回 null */
function dwsJson(args: string[], logger: Logger): DwsOutput | null {
  const result = spawnSync('dws', [...args, '--format', 'json', '-y'], {
    encoding: 'utf8',
    timeout: DWS_TIMEOUT_MS,
  });
  if (result.error || result.status !== 0) {
    logger.debug(`dws ${args.join(' ')} failed: ${result.error?.message ?? result.stderr?.slice(0, 200)}`);
    return null;
  }
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as DwsOutput;
  } catch {
    logger.debug(`dws ${args.join(' ')} returned non-JSON output`);
    return null;
  }
}

/** 从 dev 命令族的 {ok, data} 信封取 data，失败返回 null */
function envelopeData(output: DwsOutput | null): unknown {
  if (!output || output.ok !== true) return null;
  return output.data ?? null;
}

/** dws 是否可用 */
function dwsAvailable(): boolean {
  const result = spawnSync('dws', ['--help'], { encoding: 'utf8', timeout: 10_000 });
  return !result.error && result.status === 0;
}

/** 是否已登录（auth status 探测；实测输出为扁平 {success, authenticated, ...}） */
function dwsAuthenticated(logger: Logger): boolean {
  const output = dwsJson(['auth', 'status'], logger);
  if (!output) return false;
  if (typeof output.authenticated === 'boolean') return output.authenticated;
  const data = (output.data ?? {}) as Record<string, unknown>;
  if (typeof data.authenticated === 'boolean') return data.authenticated;
  return output.ok === true || output.success === true;
}

/** 交互式登录（浏览器 / 钉钉扫码授权），仅在 TTY 下唤起 */
function dwsLogin(logger: Logger): boolean {
  if (!process.stdout.isTTY) {
    logger.warn('dws 未登录且当前非交互终端，无法唤起授权流程');
    console.log('请先在终端手动执行: dws auth login');
    return false;
  }
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  dws 未登录，唤起钉钉授权（浏览器 / 扫码）...');
  console.log('══════════════════════════════════════════════════════\n');
  const result = spawnSync('dws', ['auth', 'login'], { stdio: 'inherit' });
  return !result.error && result.status === 0;
}

/** 从 dws 返回的 data 中提取凭据（兼容多种字段命名） */
function extractCredentials(data: unknown): SetupCredentials | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;

  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value) return value;
    }
    return undefined;
  };

  const clientId = pick('clientId', 'appKey', 'client_id', 'app_key');
  const clientSecret = pick('clientSecret', 'appSecret', 'client_secret', 'app_secret');
  if (!clientId || !clientSecret) return null;

  return {
    clientId,
    clientSecret,
    robotCode: pick('robotCode', 'robot_code'),
  };
}

/** 通过统一应用 ID 读取凭据 */
function fetchCredentialsByAppId(unifiedAppId: string, logger: Logger): SetupCredentials | null {
  logger.info(`通过 dws 读取应用凭证: unifiedAppId=${unifiedAppId}`);
  const data = envelopeData(dwsJson(['dev', 'app', 'credentials', 'get', '--unified-app-id', unifiedAppId], logger));
  return extractCredentials(data);
}

/** 提交建号任务并轮询结果 */
async function createRobotViaDws(logger: Logger): Promise<SetupCredentials | null> {
  const appName = process.env.DINGTALK_APP_NAME || 'dsh 智能体';
  const robotName = process.env.DINGTALK_ROBOT_NAME || 'dsh 机器人';
  const desc = process.env.DINGTALK_APP_DESC || '基于 deepseek-harness 的对话机器人';

  logger.info(`通过 dws 提交机器人创建任务: name=${appName} robot=${robotName}`);
  const submitData = envelopeData(dwsJson(
    ['dev', 'app', 'robot', 'submit', '--name', appName, '--robot-name', robotName, '--desc', desc],
    logger,
  ));
  if (submitData === null) {
    logger.warn('机器人创建任务提交失败');
    return null;
  }

  const submitRecord = submitData as { taskId?: string; task_id?: string };
  const taskId = submitRecord.taskId ?? submitRecord.task_id;
  if (!taskId) {
    // 部分实现直接同步返回凭据
    return extractCredentials(submitData);
  }

  for (let attempt = 0; attempt < CREATE_POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, CREATE_POLL_INTERVAL_MS));
    const data = envelopeData(dwsJson(['dev', 'app', 'robot', 'result', '--task-id', taskId], logger));
    const credentials = extractCredentials(data);
    if (credentials) return credentials;
    logger.debug(`建号任务处理中... (${attempt + 1}/${CREATE_POLL_MAX_ATTEMPTS})`);
  }

  logger.warn('建号任务轮询超时');
  return null;
}

// ══════════════════════════════════════════════════════════════
// 引导入口
// ══════════════════════════════════════════════════════════════

/**
 * 借助 dws 获取钉钉机器人凭据
 *
 * @param unifiedAppId 指定统一应用 ID（配置或环境变量），走 credentials get
 */
export async function runDwsSetup(unifiedAppId: string | undefined, logger: Logger): Promise<SetupCredentials | null> {
  if (!dwsAvailable()) {
    logger.info('本机未安装 dws，跳过 dws 引导');
    printEnvInstructions();
    return null;
  }

  if (!dwsAuthenticated(logger) && !dwsLogin(logger)) {
    printEnvInstructions();
    return null;
  }

  const appId = unifiedAppId || process.env.DINGTALK_UNIFIED_APP_ID;
  if (appId) {
    const credentials = fetchCredentialsByAppId(appId, logger);
    if (credentials) {
      console.log(`\n✔ 已通过 dws 获取应用凭证 (unifiedAppId=${appId})\n`);
      return credentials;
    }
    logger.warn(`读取应用凭证失败: unifiedAppId=${appId}`);
  }

  if (process.env.DSH_DINGTALK_AUTO_CREATE === '1') {
    const credentials = await createRobotViaDws(logger);
    if (credentials) {
      console.log(`\n✔ 已通过 dws 完成建号，ClientId: ${credentials.clientId}\n`);
      return credentials;
    }
  }

  printDwsInstructions(logger);
  return null;
}

/**
 * 从插件安装路径推导 profile 目录（node_modules 的父目录）
 *
 * 逐级向上查找名为 node_modules 的目录并返回其父目录。
 */
export function getProfileDir(baseDir: string): string | null {
  let dir = baseDir;
  for (let i = 0; i < 32; i++) {
    const segments = dir.split(/[\\/]/);
    if (segments[segments.length - 1] === 'node_modules') {
      return dir.slice(0, dir.length - 'node_modules'.length - 1) || null;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * 将凭据写入 dsh profile 的 cordis.patch.yml
 *
 * 用 js-yaml 解析现有文件后更新/追加 im-dingtalk 条目，再 dump 写回，
 * 保证输出始终是合法 YAML。文件不存在或为空时安全重建；
 * 解析失败或结构异常时拒绝写入、保留原文件（避免覆盖用户其他配置）。
 */
export function persistCredentialsToProfile(
  credentials: SetupCredentials,
  profileDir: string | undefined,
  logger: Logger,
): boolean {
  if (!profileDir) {
    // 开发模式：插件从源码加载、不在 node_modules 下，无法定位 profile 目录
    printEnvInstructions(credentials);
    return false;
  }

  const patchPath = resolve(profileDir, 'cordis.patch.yml');

  try {
    // 1. 解析现有条目（文件不存在/为空才重建；解析失败会抛错，保留原文件）
    let entries: PatchEntry[] = [];
    if (existsSync(patchPath)) {
      entries = parsePatchEntries(readFileSync(patchPath, 'utf8'));
    }

    // 2. 更新或追加 im-dingtalk 条目
    const configPatch: Record<string, unknown> = {
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      ...(credentials.robotCode ? { robotCode: credentials.robotCode } : {}),
    };
    const existing = entries.find((e) => e.id === 'im-dingtalk');
    if (existing) {
      existing.config = { ...(existing.config ?? {}), ...configPatch };
    } else {
      entries.push({ id: 'im-dingtalk', config: configPatch });
    }

    // 3. dump 写回（保证合法 YAML）
    const output = `# 钉钉机器人凭据（dws 引导自动生成）\n${yaml.dump(entries)}`;
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(patchPath, output, 'utf8');
    logger.info(`✔ 凭据已写入: ${patchPath}`);
    logger.info('  下次启动将自动使用保存的凭据');
    return true;
  } catch (err) {
    logger.warn(`写入配置失败: ${err instanceof Error ? err.message : String(err)}`);
    printYamlInstructions(credentials, patchPath);
    return false;
  }
}

/**
 * 解析 cordis.patch.yml 为条目数组
 *
 * - 空内容 / 仅注释 → 空数组（允许安全重建）
 * - 条目列表 → 过滤出含 id 的对象
 * - 非数组结构 / YAML 语法错误 → 抛错（由调用方保留原文件）
 */
function parsePatchEntries(content: string): PatchEntry[] {
  if (!content.trim()) return [];

  const parsed = yaml.load(content);
  if (parsed === null || parsed === undefined) return [];
  if (!Array.isArray(parsed)) {
    throw new Error('cordis.patch.yml 顶层必须是 YAML 数组');
  }
  return parsed.filter(
    (e): e is PatchEntry =>
      typeof e === 'object' && e !== null && typeof (e as Record<string, unknown>).id === 'string',
  );
}

/** 环境变量配置指引 */
function printEnvInstructions(credentials?: SetupCredentials): void {
  console.log('请通过环境变量配置钉钉机器人凭据:');
  const id = credentials?.clientId ?? '你的ClientID';
  const secret = credentials?.clientSecret ?? '你的ClientSecret';
  if (process.platform === 'win32') {
    console.log(`  set DINGTALK_CLIENT_ID=${id}`);
    console.log(`  set DINGTALK_CLIENT_SECRET=${secret}`);
  } else {
    console.log(`  export DINGTALK_CLIENT_ID="${id}"`);
    console.log(`  export DINGTALK_CLIENT_SECRET="${secret}"`);
  }
}

/** dws 凭据来源指引 */
function printDwsInstructions(logger: Logger): void {
  logger.info('dws 已就绪，但未指定凭据来源。可选：');
  console.log('  1. 使用现有应用: export DINGTALK_UNIFIED_APP_ID=<统一应用ID>');
  console.log('     （dws dev app list 可查看可用应用）');
  console.log('  2. 自动建号:     export DSH_DINGTALK_AUTO_CREATE=1');
  console.log('     （可配 DINGTALK_APP_NAME / DINGTALK_ROBOT_NAME / DINGTALK_APP_DESC）');
  console.log('  3. 手动配置:     export DINGTALK_CLIENT_ID=... DINGTALK_CLIENT_SECRET=...');
}

/** 自动写入失败时的手动配置指引 */
function printYamlInstructions(credentials: SetupCredentials, patchPath: string): void {
  console.log('无法自动保存凭据，请手动打开以下文件添加配置:');
  console.log(`  ${patchPath}`);
  console.log('');
  console.log('  - id: im-dingtalk');
  console.log('    config:');
  console.log(`      clientId: "${credentials.clientId}"`);
  console.log(`      clientSecret: "${credentials.clientSecret}"`);
  if (credentials.robotCode) {
    console.log(`      robotCode: "${credentials.robotCode}"`);
  }
}
