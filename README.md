# @d1-2004/dsh-dingtalk

基于 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) 的钉钉机器人 IM 插件，将钉钉消息平台作为 dsh agent 的前端协议驱动。

钉钉侧接入基于开放平台 **Stream 模式**（WebSocket 长连接，无需公网回调地址）。

## 架构

```
钉钉用户 → 钉钉 Stream 长连接 → dsh-im-dingtalk → ctx.agents → dsh agent loop → LLM
                    ↑                                      │
                    └────────── session/event ─────────────┘
              (assistant reply → sessionWebhook markdown 回复，
               webhook 过期时兜底走机器人主动发送 OpenAPI)
```

## 前置条件

凭据获取有两条路：

**路线 A：dws 引导（推荐，接近「扫码即用」）**

本机装有 dws CLI（钉钉 Workspace 命令行）时，插件在凭据缺失的首次启动会自动走 dws 引导：

1. 未登录时唤起 `dws auth login`（浏览器 / 钉钉扫码授权）；
2. 凭据来源二选一：
   - 已有应用：`export DINGTALK_UNIFIED_APP_ID=<统一应用ID>`（`dws dev app list` 可查），
     插件用 `dws dev app credentials get` 自动取 Client ID / Secret；
   - 全新建号：`export DSH_DINGTALK_AUTO_CREATE=1`，插件用 `dws dev app robot submit` 提交
     智能体机器人创建任务并轮询结果，直接拿到凭据（可配 `DINGTALK_APP_NAME` /
     `DINGTALK_ROBOT_NAME` / `DINGTALK_APP_DESC`）；
3. 凭据自动写入 profile 的 `cordis.patch.yml`，触发 dsh 热更新重载，后续启动无需再次引导。

**路线 B：手动配置**

1. 在[钉钉开发者后台](https://open-dev.dingtalk.com/)创建**企业内部应用**，记下 Client ID（AppKey）/ Client Secret（AppSecret）。
2. 在应用中添加「机器人」能力，**消息接收模式选择 Stream 模式**，发布应用。
3. 通过环境变量 `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET` 注入。

无论哪条路线，如需 sessionWebhook 过期后的主动发送兜底，需为应用开通机器人消息发送权限
（企业内机器人发送消息权限点 `qyapi_robot_sendmsg`）。

## 安装

### 方式一：安装到 profile

```bash
# 安装到 profile
npx @deepseek-ai/dsh plugin --profile dingtalk add @d1-2004/dsh-dingtalk

# 启动
export DINGTALK_CLIENT_ID="你的ClientID" DINGTALK_CLIENT_SECRET="你的ClientSecret"
npx @deepseek-ai/dsh --profile dingtalk
```

### 方式二：本地路径安装

```bash
# 构建
cd /path/to/dsh-dingtalk
pnpm install && pnpm build

# 安装到 profile（本地路径）
npx @deepseek-ai/dsh plugin --profile dingtalk add /path/to/dsh-dingtalk

# 启动
export DINGTALK_CLIENT_ID="你的ClientID" DINGTALK_CLIENT_SECRET="你的ClientSecret"
npx @deepseek-ai/dsh --profile dingtalk
```

### 方式三：--patch 开发模式

```bash
export DINGTALK_CLIENT_ID="xxx" DINGTALK_CLIENT_SECRET="xxx"
npx @deepseek-ai/dsh web --patch /path/to/dsh-dingtalk/cordis.dev.yml
```

## 配置项

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `clientId` | string | **必填** | 钉钉应用 Client ID / AppKey（或环境变量 `DINGTALK_CLIENT_ID`） |
| `clientSecret` | string | **必填** | 钉钉应用 Client Secret / AppSecret（或环境变量 `DINGTALK_CLIENT_SECRET`） |
| `robotCode` | string | = clientId | 机器人编码（主动发送兜底用，或环境变量 `DINGTALK_ROBOT_CODE`） |
| `unifiedAppId` | string | - | 统一应用 ID（dws 引导取凭证用，或环境变量 `DINGTALK_UNIFIED_APP_ID`） |
| `provider` | string | - | LLM 提供商名称（留空继承宿主默认） |
| `model` | string | - | 模型名称（留空继承宿主默认） |
| `preset` | string | - | Agent preset id |
| `cwd` | string | `process.cwd()` | Agent 工作目录 |
| `markdownTitle` | string | `AI 助手` | markdown 消息标题（显示在会话列表/推送通知） |
| `textChunkLimit` | number | `4000` | 单条消息最大字符数 |
| `sessionIdleTimeout` | number | `1800000` | 会话闲置超时(ms)，默认 30 分钟 |
| `access` | object | 全开放 | 访问控制（direct/group 各自支持 open/allowlist/disabled） |
| `showToolResults` | boolean | `false` | 是否展示工具调用成功结果（错误始终展示） |
| `debug` | boolean | `false` | 调试模式 |

## 内置命令

| 命令 | 说明 |
|------|------|
| `/bot-reset`（别名 `/bot-clear`） | 重置当前会话（清除上下文） |
| `/bot-new` | 开始新会话 |
| `/bot-model` | 查看或切换模型 |
| `/bot-status` | 查看当前会话状态 |
| `/bot-stop` | 中止当前生成 |
| `/bot-ping` | 连通性测试 |
| `/bot-version` | 查看版本信息 |
| `/bot-help` | 查看所有指令 |

## 核心模块

```
src/
├── index.ts                    # Cordis 插件入口（async apply）
├── config.ts                   # 配置 Schema
├── types.ts                    # 全局类型定义
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
├── session/                    # 会话管理层
│   ├── session-manager.ts      # 钉钉 peer → Agent 映射
│   └── idle-evictor.ts         # 闲置回收
├── model/                      # 模型路由层
│   ├── model-resolver.ts       # 路由解析
│   ├── prefs-store.ts          # per-peer 偏好持久化
│   └── settings-reader.ts      # settings.yaml 只读
├── commands/                   # 斜杠命令
└── shared/                     # 共享工具
```

## 会话路由

sessionKey: `dingtalk:${clientId}:${scope}:${peerId}`，由 SHA-256 确定性派生 SessionId，重启后可恢复。

- 单聊（`conversationType = "1"`）：peerId = senderStaffId
- 群聊（`conversationType = "2"`）：peerId = openConversationId

解析策略：进程内复用 → 持久化恢复 → 全新创建。

## 回复通道

1. **首选 sessionWebhook**：入站消息自带的回复 webhook，免额外权限、自动路由回原会话，
   以 `msgtype: markdown` 发送。
2. **兜底主动发送**：sessionWebhook 过期（`sessionWebhookExpiredTime`）后，自动切换到
   机器人主动发送 OpenAPI（单聊 `/v1.0/robot/oToMessages/batchSend`、
   群聊 `/v1.0/robot/groupMessages/send`，`msgKey: sampleMarkdown`），
   需要 robotCode 和相应权限点。

## 平台约束

- **群聊触发**：钉钉群聊机器人只会收到 @ 它的消息，无需 @ 门控，也拿不到未 @ 的群历史与引用消息原文。
- **消息 ack**：Stream 服务端对 60s 未响应的消息会重推，插件收到即 ack、异步处理，并有 msgId 去重兜底。
- **流式输出**：钉钉 IM 消息没有「编辑已发送消息」通道，回复为缓冲聚合后整体发送（AI 卡片流式不在本插件范围）。

## 设计原则

- **纯 Cordis 插件** — 遵循 dsh "Plugins, not loop changes" 原则
- **声明式依赖** — `inject = ['agents']`，不直接耦合其他插件
- **会话隔离** — 每个钉钉单聊用户/群聊各一个独立 Agent
- **Preset 支持** — 可通过 `agent-presets` 服务挂载预设（工具集、prompt 等）
- **闲置回收** — 超时自动 dispose Agent，防止内存泄漏
- **Markdown 输出** — 回复以 Markdown 格式发送，支持代码块/表格感知切分

## 本地开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 开发模式（watch）
pnpm dev

# 测试
pnpm test
```

## License

[MIT](./LICENSE)
