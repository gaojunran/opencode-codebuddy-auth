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
- 运行时作为 OpenCode 插件加载，通过自定义 `fetch` 拦截 `/chat/completions` 请求并注入 CodeBuddy 认证 headers
- `@opencode-ai/plugin` 是 peer dependency，仅开发时安装

## 环境

- 国内版 API：`copilot.tencent.com`，`X-Domain: www.codebuddy.cn`
- 国际版 API：`www.codebuddy.ai`，`X-Domain: www.codebuddy.ai`
- 切换环境需同时改 `CONFIG.serverUrl` 和 `CONFIG.domain`
- 模型列表通过 `GET /v3/config` 获取，可能随时变化
