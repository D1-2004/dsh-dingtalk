/**
 * AccessTokenProvider — 企业内部应用 accessToken 获取与缓存
 *
 * POST https://api.dingtalk.com/v1.0/oauth2/accessToken {appKey, appSecret}
 *   → {accessToken, expireIn}
 *
 * 缓存到过期前 5 分钟自动刷新；并发请求合并为一次刷新。
 */
import type { Logger } from '../types.js';

const TOKEN_URL = 'https://api.dingtalk.com/v1.0/oauth2/accessToken';

/** 过期安全边界（提前刷新，避免用到临期 token） */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

const HTTP_TIMEOUT_MS = 10_000;

export class AccessTokenProvider {
  private token?: string;
  private expiresAt = 0;
  private refreshing?: Promise<string>;

  constructor(
    private readonly appKey: string,
    private readonly appSecret: string,
    private readonly logger: Logger,
  ) {}

  async get(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - EXPIRY_MARGIN_MS) {
      return this.token;
    }
    if (!this.refreshing) {
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  private async refresh(): Promise<string> {
    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appKey: this.appKey, appSecret: this.appSecret }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!resp.ok) {
      throw new Error(`getAccessToken failed: HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as { accessToken?: string; expireIn?: number };
    if (!data.accessToken) {
      throw new Error('getAccessToken failed: empty accessToken');
    }
    this.token = data.accessToken;
    this.expiresAt = Date.now() + (data.expireIn ?? 7200) * 1000;
    this.logger.debug(`im-dingtalk: accessToken refreshed, expireIn=${data.expireIn ?? 7200}s`);
    return this.token;
  }
}
