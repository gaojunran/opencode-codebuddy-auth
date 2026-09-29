# AGENTS.md

## 项目概述

OpenCode 插件，为 CodeBuddy 提供 IOA OAuth 认证和请求拦截。单文件项目，入口 `src/index.ts`。

## 构建

```bash
npm install && npm run build   # tsc 编译到 dist/
```

无测试、无 lint、无 CI。只有 `npm run build`。

## 架构要点

- `src/index.ts` 是唯一源文件，导出 `CodeBuddyAuthPlugin`（Plugin 类型）和 default export
- default export 同时携带 `setup`（opencode v2）与 `server`（v1.18.29+）双入口；v2 API（@opencode/plugin）仅在 setup 内动态 import——v1 运行时无该包，顶层静态引用会让 v1 加载失败
- v2 机制对应：config hook → `provider.transform(editor.add)`；auth.loader 自定义 fetch → `session.hook("http.request"/"http.response"/"retry")`；auth.methods → `integration.transform(editor.method.update)`
- 根目录 `index.ts` 是本地路径加载入口（opencode v2 的 plugins 目录条目解析根 index.ts 直跑 TS）；npm 包消费走 package.json exports → dist/
- 运行时作为 OpenCode 插件加载，通过自定义 `fetch` 拦截 `/chat/completions` 请求并注入 CodeBuddy 认证 headers
- `@opencode-ai/plugin` 是 peer dependency，仅开发时安装

### 核心 Hooks

1. **config** — 启动时从 `~/.local/share/opencode/auth.json` 读取已保存的 access token，调用 `GET /v3/config` 动态获取 craft agent 可用模型，注入到 `config.provider.codebuddy.models`；默认（国内端点）还会额外拉取国际端点 `/v3/config` 的 craft 列表去重合并，并合并内置补充清单（claude / gpt-5.6 系列），使 GPT-5.6/Claude/Gemini 等模型可用（对话仍走主端点）；未登录或获取失败时 fallback 为 `auto` 默认模型；不覆盖用户手动声明的 models
2. **auth** — IOA OAuth 登录流程（浏览器 → 轮询 token），loader 返回自定义 fetch 拦截请求
3. **chat.params** — 设置 baseURL

### 用户配置

`codebuddy` 不在 models.dev 数据库中，插件通过 `config` hook 自动创建 `provider.codebuddy`（如未声明），并动态注入 models。支持三种配置方式：
1. 只加 `plugin`，不声明 provider（推荐，全自动）
2. 声明 provider 不声明 models（自动发现模型）
3. 手动声明 provider + models（完全手动控制）

另支持通过 plugin options 配置 `extraModels`（`["opencode-codebuddy-auth-fixed", { "extraModels": [...] }]`）覆盖内置补充清单；未提供时使用 `EXTRA_MODELS` 默认清单（claude / gpt-5.6 系列）。补充模型按 id 去重合并，不覆盖 `/v3/config` 发现或用户手动声明的 models。

## 环境

- 默认国内版 API：`copilot.tencent.com`，`X-Domain: www.codebuddy.cn`
- 国际版 API：`www.codebuddy.ai`，`X-Domain: www.codebuddy.ai`
- 默认值在 `CONFIG.serverUrl` / `CONFIG.domain`；配置了 `baseURL` 时域名按是否含 `codebuddy.ai` 自动双向检测
- 模型发现：主端点 craft 列表；主端点为国内时额外合并国际端点 craft 列表（去重，主端点优先）
- 国际版模型（GPT-5.6/Gemini 等）在国内端点后端可直接调用（已实测），因此无需国际登录
- 模型列表通过 `GET /v3/config` 获取（需 access token），可能随时变化
- Token 存储路径：`~/.local/share/opencode/auth.json`（插件唯一事实源：登录/刷新均写回此文件）
- v2 的 connection 存储在 `opencode.db` 的 `credential` 表（`cred_*` 行）；曾因读 connection 写 auth.json 不一致导致 resolve 命中已吊销旧 token（HTTP 401）
- 刷新端点 `/v2/plugin/auth/token/refresh` 只认 `X-Refresh-Token` 头（Authorization/body 均报 10001:refreshToken is empty）
