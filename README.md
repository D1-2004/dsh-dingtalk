# @d1-2004/dsh-dingtalk

把钉钉机器人接入 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) 的 IM 插件：钉钉消息平台作为 dsh agent 的前端协议驱动，@机器人 / 单聊即可对话本地 agent。

- **Stream 模式接入** — 开放平台 WebSocket 长连接，无需公网回调地址，断线自动重连
- **双通道回复** — 首选 sessionWebhook 免权限回复，过期自动兜底机器人主动发送 OpenAPI
- **会话隔离与恢复** — 每个单聊用户 / 群聊一个独立 agent，SessionId 确定性派生，重启可恢复上下文
- **串行与合并** — 同会话严格串行；处理期间连发的消息合并为一个最新请求，不打断当前轮
- **凭据引导** — 本机有 dws CLI 时可「扫码即用」：授权 → 取凭证 / 建号 → 自动写入 profile
- **全消息类型入站** — 文本 / 富文本 / 语音（识别文本）/ 图片 / 视频 / 文件归一化为 agent 可读内容，未知类型不丢弃

## 快速开始

```bash
# 1. 安装到 dsh profile
npx @deepseek-ai/dsh plugin --profile dingtalk add @d1-2004/dsh-dingtalk

# 2. 配置凭据（或跳过此步，走下方 dws 引导）
export DINGTALK_CLIENT_ID="你的ClientID" DINGTALK_CLIENT_SECRET="你的ClientSecret"

# 3. 启动
npx @deepseek-ai/dsh --profile dingtalk
```

启动后在钉钉里单聊机器人、或群里 @机器人 发消息即可。

## 凭据获取

### 路线 A：dws 引导（推荐，接近「扫码即用」）

本机装有 dws CLI（钉钉 Workspace 命令行）时，插件在凭据缺失的首次启动会自动走 dws 引导：

1. 未登录时唤起 `dws auth login`（浏览器 / 钉钉扫码授权）；
2. 凭据来源二选一：

   | 场景 | 配置 | 插件行为 |
   |------|------|----------|
   | 已有应用 | `export DINGTALK_UNIFIED_APP_ID=<统一应用ID>`（`dws dev app list` 可查） | `dws dev app credentials get` 自动取 Client ID / Secret |
   | 全新建号 | `export DSH_DINGTALK_AUTO_CREATE=1` | `dws dev app robot submit` 提交智能体机器人创建任务并轮询，直接拿到凭据 |

   建号可选配 `DINGTALK_APP_NAME` / `DINGTALK_ROBOT_NAME` / `DINGTALK_APP_DESC`。
3. 凭据自动写入 profile 的 `cordis.patch.yml`，触发 dsh 热更新重载，后续启动无需再次引导。

### 路线 B：手动配置

1. 在[钉钉开发者后台](https://open-dev.dingtalk.com/)创建**企业内部应用**，记下 Client ID（AppKey）/ Client Secret（AppSecret）。
2. 在应用中添加「机器人」能力，**消息接收模式选择 Stream 模式**，发布应用。
3. 通过环境变量 `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET` 注入。

> 无论哪条路线，如需 sessionWebhook 过期后的主动发送兜底，需为应用开通企业内机器人发送消息权限点 `qyapi_robot_sendmsg`。

## 其它安装方式

```bash
# 本地路径安装（先构建再指向本地目录）
cd /path/to/dsh-dingtalk && pnpm install && pnpm build
npx @deepseek-ai/dsh plugin --profile dingtalk add /path/to/dsh-dingtalk

# --patch 开发调试（不安装，直接叠加本仓 patch）
export DINGTALK_CLIENT_ID="xxx" DINGTALK_CLIENT_SECRET="xxx"
npx @deepseek-ai/dsh web --patch /path/to/dsh-dingtalk/cordis.patch.yml
```

仓库根目录的 `cordis.yml` 是一份从零组合 dsh spine + 本插件的完整示例，可用
`pnpm dsh --config ./cordis.yml` 独立启动。

## 配置项

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `clientId` | string | **必填** | 钉钉应用 Client ID / AppKey（或环境变量 `DINGTALK_CLIENT_ID`） |
| `clientSecret` | string | **必填** | 钉钉应用 Client Secret / AppSecret（或环境变量 `DINGTALK_CLIENT_SECRET`） |
| `robotCode` | string | = clientId | 机器人编码，主动发送兜底用（或环境变量 `DINGTALK_ROBOT_CODE`） |
| `unifiedAppId` | string | - | 统一应用 ID，dws 引导取凭证用（或环境变量 `DINGTALK_UNIFIED_APP_ID`） |
| `provider` | string | - | LLM 提供商名称（留空继承宿主默认） |
| `model` | string | - | 模型名称（留空继承宿主默认） |
| `preset` | string | - | Agent preset id |
| `cwd` | string | `process.cwd()` | Agent 工作目录 |
| `markdownTitle` | string | `AI 助手` | markdown 消息标题（显示在会话列表 / 推送通知） |
| `textChunkLimit` | number | `4000` | 单条消息最大字符数，超长自动切分 |
| `sessionIdleTimeout` | number | `1800000` | 会话闲置超时(ms)，超时自动回收 agent |
| `access` | object | 全开放 | 访问控制，direct/group 各自支持 open / allowlist / disabled |
| `showToolResults` | boolean | `false` | 是否展示工具调用成功结果（错误始终展示） |
| `debug` | boolean | `false` | 调试模式 |

## 内置命令

| 命令 | 说明 |
|------|------|
| `/bot-reset`（别名 `/bot-clear`） | 重置当前会话（清除上下文） |
| `/bot-new` | 开始新会话 |
| `/bot-model` | 查看或切换模型（fork 保留上下文） |
| `/bot-status` | 查看当前会话状态 |
| `/bot-stop` | 中止当前生成 |
| `/bot-ping` | 连通性测试 |
| `/bot-version` | 查看版本信息 |
| `/bot-help` | 查看所有指令 |

## 消息类型支持

| 入站 msgtype | 处理方式 |
|--------------|----------|
| `text` | 原文透传；正文为空时尝试 `content.markdown/text/title/recognition` 等字段形状 |
| `richText` | 文本片段拼接，图片以数量占位说明 |
| `audio` | 使用语音识别文本（带时长标注） |
| `picture` / `video` | 占位说明（暂不下载） |
| `file` | 文件名占位说明（暂不下载） |
| 其它 / 未来新增 | 不丢弃：脱敏后的原始消息 JSON 交给模型自行理解（sessionWebhook 等敏感字段已剥离） |

出站统一为 markdown（`msgtype: markdown` / `msgKey: sampleMarkdown`），超长按
代码块 / GFM 表格边界感知切分，避免语法块被拦腰截断。

## 架构

```
钉钉用户 ──@/单聊──▶ Stream 长连接 ──▶ 入站管线 ──▶ ctx.agents ──▶ dsh agent loop ──▶ LLM
                    (收到即 ack)      (去重/ACL/命令)     │
                                                    session/event
                                                          │
钉钉用户 ◀── markdown 回复 ◀── sessionWebhook ──┬─── 出站缓冲 ◀┘
                              (过期兜底 OpenAPI) ┘
```

### 核心模块

```
src/
├── index.ts                    # Cordis 插件入口（async apply）
├── config.ts                   # 配置 Schema
├── setup.ts                    # 凭据引导（dws 授权/取凭证/建号 + profile 持久化）
├── dingtalk/                   # 钉钉平台接入层
│   ├── token.ts                # access token 获取与缓存
│   ├── sender.ts               # sessionWebhook 回复 + 主动发送兜底
│   └── types.ts                # 钉钉入站消息 / API 类型
├── gateway/                    # 网关组装
│   ├── bootstrap.ts            # Stream 客户端初始化 + 事件接线 + 生命周期
│   └── pipeline.ts             # 入站管线（去重/访问控制/命令分发）
├── transport/                  # 传输层
│   ├── inbound.ts              # 钉钉入站消息 → agent.followup()
│   ├── outbound.ts             # session/event → 钉钉 markdown 回复
│   ├── outbound-buffer.ts      # 出站缓冲
│   └── chunker.ts              # Markdown 文本切分
├── session/                    # 会话管理层（peer → Agent 映射、闲置回收）
├── model/                      # 模型路由层（解析、per-peer 偏好、settings 只读）
├── commands/                   # 斜杠命令
└── shared/                     # 共享工具
```

### 会话路由

sessionKey: `dingtalk:${clientId}:${scope}:${peerId}`，由 SHA-256 确定性派生 SessionId，重启后可恢复。

- 单聊（`conversationType = "1"`）：peerId = senderStaffId
- 群聊（`conversationType = "2"`）：peerId = openConversationId

解析策略：进程内复用 → 持久化恢复 → 全新创建。

### 回复通道

1. **首选 sessionWebhook**：入站消息自带的回复 webhook，免额外权限、自动路由回原会话。
2. **兜底主动发送**：sessionWebhook 过期（临期 15s 判定）或发送失败时，自动切换到机器人
   主动发送 OpenAPI（单聊 `/v1.0/robot/oToMessages/batchSend`、群聊
   `/v1.0/robot/groupMessages/send`），需要 robotCode 和 `qyapi_robot_sendmsg` 权限点。
   agent 长任务跑完晚于 webhook 有效期时，回复仍能送达。

### 平台约束

- **群聊触发**：钉钉群聊机器人只会收到 @ 它的消息，无需 @ 门控，也拿不到未 @ 的群历史与引用消息原文。
- **消息 ack**：Stream 服务端对 60s 未响应的消息会重推，插件收到即 ack、异步处理，并有 msgId 去重兜底。
- **流式输出**：钉钉 IM 消息没有「编辑已发送消息」通道，回复为缓冲聚合后整体发送（AI 卡片流式见 Roadmap）。

### 工程化处理

以下处理参考了钉钉 Workspace CLI（dws）`dev connect` 机器人的开源实现
（[DingTalk-Real-AI/dingtalk-workspace-cli](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli)）中踩过的坑：

- **同会话串行 + 突发合并**：agent 处理期间同会话的新消息不立即投递（避免中途 steering
  污染当前轮），turn 结束后整批合并为「用户连续发送了以下消息」一个请求；斜杠命令不参与合并。
- **发送重试**：sessionWebhook / OpenAPI 的瞬时错误（EOF、timeout、5xx、429）按 1s/2s/4s
  指数退避重试，一次网络抖动不等于整轮丢答案；权限类错误不重试。
- **单实例锁**：钉钉对同 clientId 的多条 Stream 连接做负载均衡分流，双实例并存会表现为
  「机器人时灵时不灵」。插件用 pid 锁文件保证同机单实例，陈旧锁自动接管。
- **未知消息类型不丢弃**：不按 msgtype 白名单过滤，正文多级 fallback 后仍不识别的消息，
  把脱敏后的原始 JSON 交给模型解释——钉钉新增消息类型无需插件发版。

## 设计原则

- **纯 Cordis 插件** — 遵循 dsh "Plugins, not loop changes" 原则
- **声明式依赖** — `inject = ['agents']`，不直接耦合其他插件
- **会话隔离** — 每个钉钉单聊用户 / 群聊各一个独立 Agent
- **Preset 支持** — 可通过 `agent-presets` 服务挂载预设（工具集、prompt 等）
- **闲置回收** — 超时自动 dispose Agent，防止内存泄漏

## Roadmap

- **AI 卡片流式回复**：卡片「思考中 → 完成」状态机（create → deliver → 流式帧 → finalize），
  失败自动降级普通消息；帧节流与 repair 帧等细节在 dws 实现里已有成熟参考。
- **附件下载落地**：downloadCode 换临时链接下载到 agent 工作目录，让 agent 真正读取
  图片 / 文件内容（含大小上限与超限清理）。
- **健康档案**：心跳文件记录 lastPush / lastReply / lastError，供外部判活与故障定位。

## 本地开发

```bash
pnpm install     # 安装依赖
pnpm build       # 构建
pnpm dev         # 开发模式（watch）
pnpm test        # 测试
```

## License

[MIT](./LICENSE)
