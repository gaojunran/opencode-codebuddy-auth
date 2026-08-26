# opencode-codebuddy-auth

OpenCode 插件，用于 CodeBuddy (IOA) 认证。通过浏览器 OAuth 登录后，可在 OpenCode CLI 中使用 CodeBuddy 的对话模型。支持自动从 `/v3/config` 动态获取可用模型列表，支持国内版和国际版切换。

> 本仓库是 [`kuops/opencode-codebuddy-auth`](https://github.com/kuops/opencode-codebuddy-auth) 的分支，额外修复了 codebuddy 流式推理被逐词碎片化的问题（见下文「与上游差异」）。

## 安装

在 `opencode.json` 中添加插件即可，三种配置方式任选其一：

#### 方式一：最简配置（推荐）

只需添加插件，provider 和 models 由插件自动创建和发现：

```jsonc
{
  "plugin": ["opencode-codebuddy-auth-fixed"]
}
```

#### 方式二：声明 provider，自动发现 models

手动声明 provider 配置，但无需写 models（由 `config` hook 自动注入）：

```jsonc
{
  "plugin": ["opencode-codebuddy-auth"],
  "provider": {
    "codebuddy": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "CodeBuddy",
      "options": {
        "baseURL": "https://copilot.tencent.com/v2",
        "setCacheKey": true
      }
    }
  }
}
```

#### 方式三：手动声明 models

完全手动控制模型列表，插件不会覆盖已有条目：

```jsonc
{
  "plugin": ["opencode-codebuddy-auth"],
  "provider": {
    "codebuddy": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "CodeBuddy",
      "options": {
        "baseURL": "https://copilot.tencent.com/v2",
        "setCacheKey": true
      },
      "models": {
        "auto":                    { "name": "Auto", "contextLength": 168000 },
        "hy3-preview-agent":       { "name": "Hy3-preview", "contextLength": 192000 },
        "glm-5v-turbo":            { "name": "GLM-5v-Turbo", "contextLength": 200000 },
        "glm-5.1":                 { "name": "GLM-5.1", "contextLength": 200000 },
        "glm-5.0-turbo":           { "name": "GLM-5.0-Turbo", "contextLength": 200000 },
        "glm-4.6":                 { "name": "GLM-4.6", "contextLength": 168000 },
        "kimi-k2.6":               { "name": "Kimi-K2.6", "contextLength": 256000 },
        "kimi-k2.5":               { "name": "Kimi-K2.5", "contextLength": 256000 },
        "deepseek-v4-pro":         { "name": "DeepSeek-V4-Pro", "contextLength": 1000000 },
        "deepseek-v4-flash":       { "name": "DeepSeek-V4-Flash", "contextLength": 1000000 },
        "deepseek-v3-2-volc":      { "name": "DeepSeek-V3.2", "contextLength": 96000 }
      }
    }
  }
}
```

> 插件通过 `config` hook 在启动时动态从 CodeBuddy API (`GET /v3/config`) 获取 craft agent 可用模型，自动注入到 `provider.codebuddy.models`。未登录时 fallback 为 `auto` 默认模型。如需覆盖，可在 `provider.codebuddy.models` 中手动声明，插件不会覆盖已有条目。

## 登录

```bash
opencode providers login --provider codebuddy
```

浏览器会打开 IOA 登录页面，完成后 token 自动保存到本地。

## 查看可用模型

```bash
# 非交互式列出
opencode models codebuddy

# 交互式选择（OpenCode 内输入 /model 搜索 codebuddy）
```

IOA 登录后，config hook 会通过 `GET /v3/config` 实时获取 craft agent 可用模型并自动注入。

#### craft agent 支持的模型（来自 `/v3/config` 接口，可能随时更新）

默认（国内端点）发现 = 国内 craft 列表 ∪ 国际端点 craft 列表 ∪ 内置补充清单（claude / gpt-5.6 系列，去重合并，对话仍走国内端点）。

| 模型 ID | 名称 | 上下文 | 图片 | 推理 |
|---------|------|--------|------|------|
| `auto` | Auto | 168K | Yes | Yes |
| `default-model` | Auto（国际） | 176K | Yes | - |
| `hy3` / `hy3-x` | Hy3 | 192K | Yes | Yes |
| `gpt-5.6-sol` | GPT-5.6-Sol | 1M | Yes | Yes |
| `gpt-5.6-terra` | GPT-5.6-Terra | 1M | Yes | Yes |
| `gpt-5.6-luna` | GPT-5.6-Luna | 1M | Yes | Yes |
| `gpt-5.5` | GPT-5.5 | 1M | Yes | Yes |
| `gpt-5.4` | GPT-5.4 | 272K | Yes | Yes |
| `gpt-5.3-codex` | GPT-5.3-Codex | 272K | Yes | Yes |
| `gemini-3.5-flash` | Gemini-3.5-Flash | 1M | Yes | Yes |
| `glm-5.3` | GLM-5.3 | 1M | Yes | Yes |
| `glm-5.2` | GLM-5.2 | 1M | Yes | Yes |
| `glm-5.1` | GLM-5.1 | 200K | Yes | Yes |
| `glm-5v-turbo` | GLM-5v-Turbo | 200K | Yes | Yes |
| `kimi-k3-1` | Kimi-K3 | 1M | Yes | Yes |
| `kimi-k2.7` | Kimi-K2.7-Code | 256K | Yes | Yes |
| `kimi-k2.6` | Kimi-K2.6 | 256K | Yes | Yes |
| `minimax-m3` | MiniMax-M3 | 512K | Yes | Yes |
| `deepseek-v4-pro` | Deepseek-V4-Pro | 1M | Yes | Yes |
| `deepseek-v4-flash` | Deepseek-V4-Flash | 1M | Yes | Yes |
| `claude-sonnet-5` | Claude-Sonnet-5 | 200K | Yes | Yes |
| `claude-sonnet-5-1m` | Claude-Sonnet-5-1M | 1M | Yes | Yes |
| `claude-sonnet-4.6` | Claude-Sonnet-4.6 | 176K | Yes | Yes |
| `claude-sonnet-4.6-1m` | Claude-Sonnet-4.6-1M | 1M | Yes | Yes |
| `claude-opus-4.8` | Claude-Opus-4.8 | 176K | Yes | Yes |
| `claude-opus-4.8-1m` | Claude-Opus-4.8-1M | 1M | Yes | Yes |
| `claude-opus-4.7` | Claude-Opus-4.7 | 176K | Yes | Yes |
| `claude-opus-4.7-1m` | Claude-Opus-4.7-1M | 1M | Yes | Yes |
| `claude-opus-4.6` | Claude-Opus-4.6 | 176K | Yes | Yes |
| `claude-opus-4.6-1m` | Claude-Opus-4.6-1M | 1M | Yes | Yes |
| `claude-haiku-4.5` | Claude-Haiku-4.5 | 176K | Yes | Yes |

#### 动态获取模型列表

```bash
curl -H 'Accept: application/json, text/plain, */*' \
     -H 'X-Requested-With: XMLHttpRequest' \
     -H 'Authorization: Bearer <TOKEN>' \
     -H 'X-User-Id: <USER_ID>' \
     -H 'X-Domain: www.codebuddy.cn' \
     -H 'X-Product: SaaS' \
     -H 'X-IDE-Type: VSCode' \
     -H 'X-IDE-Name: VSCode' \
     -H 'X-IDE-Version: 1.119.0' \
     -H 'X-Product-Version: 4.9.29177644' \
     -H 'X-Request-Trace-Id: <UUID>' \
     -H 'X-Env-ID: production' \
     -H 'User-Agent: VSCode/1.119.0 CodeBuddy/4.9.29177644' \
     'https://copilot.tencent.com/v3/config'
```

- `data.models` — 所有可用模型的详细信息
- `data.agents[0].models` — craft agent 可用的模型 ID 列表

### 自定义模型补充清单（extraModels）

`/v3/config` 的 craft 列表未暴露部分后端实际可用的模型（如 claude、gpt-5.6 系列）。插件默认内置一份实测可用的补充清单并合并注入；如需自定义，可在 `plugin` 条目的 options 中提供 `extraModels`，提供后将**整体替换**内置清单：

```jsonc
{
  "plugin": [
    [
      "opencode-codebuddy-auth-fixed",
      {
        "extraModels": [
          { "id": "claude-sonnet-5", "name": "Claude-Sonnet-5", "context": 200000, "output": 64000 }
        ]
      }
    ]
  ]
}
```

条目字段：`id`（必填）、`name`、`context`（上下文）、`output`（输出上限）、`tool_call`（默认 true）、`attachment`（默认 true）。补充模型按 id 去重合并，不覆盖 `/v3/config` 已发现或用户手动声明的 models。未配置 `extraModels` 时使用内置默认清单（claude / gpt-5.6 系列，见上方模型表）。

## 环境变量

通过 shell `export` 设置，普通用户无需配置（JWT 自动提取）：

```bash
# 强制使用指定模型（忽略 OpenCode 模型选择）
export CODEBUDDY_DEFAULT_MODEL=deepseek-v3-2-volc

# 覆盖企业/租户信息（不设置则从 JWT 自动提取）
export CODEBUDDY_TENANT_ID=xxx
export CODEBUDDY_ENTERPRISE_ID=xxx
export CODEBUDDY_USER_ID=xxx

opencode
```

| 变量 | 说明 | 必需 |
|------|------|------|
| `CODEBUDDY_DEFAULT_MODEL` | 强制使用指定模型（不设置则使用 OpenCode 选择的模型） | 否 |
| `CODEBUDDY_TENANT_ID` | 覆盖 tenant_id（不设置则从 JWT 自动提取） | 否 |
| `CODEBUDDY_ENTERPRISE_ID` | 覆盖 enterprise_id（不设置则从 JWT 自动提取） | 否 |
| `CODEBUDDY_USER_ID` | 覆盖 user_id（不设置则从 JWT 自动提取） | 否 |

## 国内版 vs 国际版

默认使用**国内版**（`copilot.tencent.com`）。模型发现 = 国内 craft 列表 ∪ 国际端点 `www.codebuddy.ai` 的 craft 列表 ∪ 内置补充清单（claude / gpt-5.6 系列），去重合并。因此 **GPT-5.6 系列、Claude、Gemini 等模型会出现在模型列表中，对话仍走国内端点** —— 这些模型在国内端点后端可直接调用（已实测），无需国际账号登录。

如需完整切换到国际版（对话也走国际端点），修改 `baseURL` 即可，插件会自动检测并切换 `X-Domain`：

```jsonc
{
  "plugin": ["opencode-codebuddy-auth"],
  "provider": {
    "codebuddy": {
      "options": {
        "baseURL": "https://www.codebuddy.ai/v2"
      }
    }
  }
}
```

| 环境 | baseURL | X-Domain（自动检测） |
|------|---------|---------|
| 国内版（默认） | `https://copilot.tencent.com/v2` | `www.codebuddy.cn` |
| 国际版 | `https://www.codebuddy.ai/v2` | `www.codebuddy.ai` |

> 插件根据 `baseURL` 自动设置 `X-Domain`：检测到 `codebuddy.ai` 时使用 `www.codebuddy.ai`，否则使用 `www.codebuddy.cn`。国际版模式下发现只取国际列表（不合并），且需要国际账号登录。

## 工作原理

```
OpenCode CLI
  ├─ config hook → 读取 ~/.local/share/opencode/auth.json 获取 token
  │                 调用 GET /v3/config 动态获取 craft agent 可用模型
  │                 注入到 config.provider.codebuddy.models
  ├─ auth hook → 浏览器 IOA OAuth → 获取 access_token + refresh_token
  ├─ loader() → 返回 { apiKey, baseURL, fetch }
  │              fetch 拦截所有 /chat/completions 请求
  └─ 对话流程 → 拦截请求
                附加认证 headers（Authorization, B3 追踪, X-Model-ID 等）
                转发到 CodeBuddy /v2/chat/completions
                直接透传 OpenAI 兼容 SSE 响应
```

- **自定义 fetch** 拦截所有 `/chat/completions` 请求，绕过 AI SDK 默认认证
- **自动 token 刷新** — 遇到 401/403 时自动刷新 token 后重试
- **无需 SSE 转换** — API 已直接返回标准 OpenAI 格式

## 与上游差异

CodeBuddy 后端在 **每一帧** SSE 中都下发 `tool_calls: []`（空数组，非 null）。而
`@ai-sdk/openai-compatible` 的解析器对任何非 null 的 `tool_calls` 都会触发一次
`reasoning-end`，于是推理流被逐词重置成独立的 thinking 块——TUI 里表现为"每个字
一个 Thinking 块"（几千个小块，每个显示 `Thought: Nms`）。

本分支在插件的自定义 fetch 透传 SSE 前，对每个 `data:` 帧做流式改写：把空
`tool_calls` 数组归一为 `null`。真实工具调用不受影响（非空数组原样保留），
连续推理会累积成单个 thinking 块。

```bash
# 安装本分支（npm 包名与上游不同）
npm i -D opencode-codebuddy-auth-fixed
```

> 该问题的根因在 CodeBuddy 后端（不应在无工具调用的流里下发空数组），同时
> 也在 `@ai-sdk/openai-compatible` 解析器（对空数组的 `!= null` 判断过于宽松）。
> 若上游修复任意一端，此改写逻辑自然退化为无害透传。

## 开发

```bash
npm install
npm run build
```

## 许可证

MIT
