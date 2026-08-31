import type {
  Hooks,
  PluginInput,
  Plugin,
} from "@opencode-ai/plugin";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const PROVIDER_ID = "codebuddy";

const CONFIG = {
  serverUrl: "https://copilot.tencent.com",
  chatCompletionsPath: "/v2/chat/completions",
  platform: "VSCode",
  appVersion: "4.9.29177644",
  ideName: "VSCode",
  ideType: "VSCode",
  ideVersion: "1.119.0",
  domain: "www.codebuddy.cn",
  product: "SaaS",
  agentIntent: "craft",
  envId: "production",
  tenantId: process.env.CODEBUDDY_TENANT_ID || "",
  enterpriseId: process.env.CODEBUDDY_ENTERPRISE_ID || "",
  userId: process.env.CODEBUDDY_USER_ID || "",
  defaultModel: process.env.CODEBUDDY_DEFAULT_MODEL || "",
};

interface JwtPayload {
  iss?: string;
  tenant_id?: string;
  tenantId?: string;
  enterprise_id?: string;
  enterpriseId?: string;
  ent_id?: string;
  entId?: string;
  user_id?: string;
  userId?: string;
  uid?: string;
  sub?: string;
  realm_access?: { roles?: string[] };
  resource_access?: { account?: { roles?: string[] } };
}

interface AuthStateResponse {
  code: number;
  data?: {
    state: string;
    authUrl?: string;
  };
}

interface TokenPollResponse {
  code: number;
  data?: {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  };
}

interface RefreshResponse {
  code: number;
  data?: {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  };
}

interface OpenAIRequest {
  model?: string;
  stream?: boolean;
  response_format?: unknown;
  [key: string]: unknown;
}

interface RemoteModel {
  id: string;
  name: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  supportsToolCall?: boolean;
  supportsImages?: boolean;
  supportsReasoning?: boolean;
}

interface RemoteConfigResponse {
  code: number;
  data?: {
    agents?: Array<{ name: string; models?: string[] }>;
    models?: RemoteModel[];
  };
}

const DEFAULT_MODEL: RemoteModel = { id: "auto", name: "Auto", maxInputTokens: 168000, maxOutputTokens: 32000, supportsToolCall: true };

// /v3/config 的 craft 列表（国内外）均不暴露 claude / gpt-5.6 系列模型，但它们在
// 国内端点后端可直接调用（已实测 copilot.tencent.com/v2）。这里按产品目录元数据补充，
// 仅在国内端点主模式下合并；若后端 /v3/config 之后补上同 id 模型，则以前者为准（此处不覆盖）。
const EXTRA_MODELS: RemoteModel[] = [
  { id: "claude-sonnet-4.6", name: "Claude-Sonnet-4.6", maxInputTokens: 176000, maxOutputTokens: 24000, supportsToolCall: true, supportsImages: true },
  { id: "claude-sonnet-5-1m", name: "Claude-Sonnet-5-1M", maxInputTokens: 1000000, maxOutputTokens: 128000, supportsToolCall: true, supportsImages: true },
  { id: "claude-sonnet-5", name: "Claude-Sonnet-5", maxInputTokens: 200000, maxOutputTokens: 64000, supportsToolCall: true, supportsImages: true },
  { id: "claude-sonnet-4.6-1m", name: "Claude-Sonnet-4.6-1M", maxInputTokens: 1000000, maxOutputTokens: 24000, supportsToolCall: true, supportsImages: true },
  { id: "claude-opus-4.8", name: "Claude-Opus-4.8", maxInputTokens: 176000, maxOutputTokens: 64000, supportsToolCall: true, supportsImages: true },
  { id: "claude-opus-4.8-1m", name: "Claude-Opus-4.8-1M", maxInputTokens: 1000000, maxOutputTokens: 128000, supportsToolCall: true, supportsImages: true },
  { id: "claude-opus-4.7", name: "Claude-Opus-4.7", maxInputTokens: 176000, maxOutputTokens: 64000, supportsToolCall: true, supportsImages: true },
  { id: "claude-opus-4.7-1m", name: "Claude-Opus-4.7-1M", maxInputTokens: 1000000, maxOutputTokens: 128000, supportsToolCall: true, supportsImages: true },
  { id: "claude-opus-4.6", name: "Claude-Opus-4.6", maxInputTokens: 176000, maxOutputTokens: 24000, supportsToolCall: true, supportsImages: true },
  { id: "claude-opus-4.6-1m", name: "Claude-Opus-4.6-1M", maxInputTokens: 1000000, maxOutputTokens: 64000, supportsToolCall: true, supportsImages: true },
  { id: "claude-haiku-4.5", name: "Claude-Haiku-4.5", maxInputTokens: 176000, maxOutputTokens: 24000, supportsToolCall: true, supportsImages: true },
  { id: "gpt-5.6-sol", name: "GPT-5.6-Sol", maxInputTokens: 1050000, maxOutputTokens: 128000, supportsToolCall: true, supportsImages: true },
  { id: "gpt-5.6-terra", name: "GPT-5.6-Terra", maxInputTokens: 1050000, maxOutputTokens: 128000, supportsToolCall: true, supportsImages: true },
  { id: "gpt-5.6-luna", name: "GPT-5.6-Luna", maxInputTokens: 1050000, maxOutputTokens: 128000, supportsToolCall: true, supportsImages: true },
];

// 插件设置：opencode 配置中 plugin 条目的 options（["opencode-codebuddy-auth-fixed", { ... }]）。
// extraModels 提供后整体替换内置补充清单，未提供则用上面的默认清单。
interface PluginSettings {
  extraModels?: Array<{
    id: string;
    name?: string;
    context?: number;
    output?: number;
    tool_call?: boolean;
    attachment?: boolean;
  }>;
}

function settingsToRemoteModels(list: PluginSettings["extraModels"]): RemoteModel[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => m && typeof m.id === "string" && m.id)
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      maxInputTokens: m.context,
      maxOutputTokens: m.output,
      supportsToolCall: m.tool_call !== false,
      supportsImages: m.attachment !== false,
    }));
}

const DISCOVERY_TIMEOUT_MS = 5000;

let resolvedServerUrl = CONFIG.serverUrl;
let resolvedDomain = CONFIG.domain;

// CodeBuddy 网关的前缀缓存按 X-Conversation-ID 维度生效（实测：换一个新 conversation id
// 就是新会话，prompt 前缀内容一模一样也不会命中；同 conversation id 下重复/增长的前缀
// 命中率 ~95%+）。真实 CodeBuddy IDE 一次对话保持同一 conversation id，而旧实现每次
// 请求都重新生成，导致 gpt-5.6 等模型每个请求都冷启动（缓存读取恒为 0、写入顶满）。
// 这里为每个 opencode session 分配并复用同一个 conversation id（进程内缓存，FIFO 上限），
// 使同一会话的后续请求能命中网关前缀缓存。
const MAX_TRACKED_SESSIONS = 128;
const sessionConversationIds = new Map<string, string>();

function conversationIdForSession(sessionID: string): string {
  const existing = sessionConversationIds.get(sessionID);
  if (existing) return existing;
  if (sessionConversationIds.size >= MAX_TRACKED_SESSIONS) {
    const oldest = sessionConversationIds.keys().next().value;
    if (oldest !== undefined) sessionConversationIds.delete(oldest);
  }
  const id = generateTraceId();
  sessionConversationIds.set(sessionID, id);
  return id;
}

function remoteModelToConfig(m: RemoteModel): Record<string, unknown> {
  const entry: Record<string, unknown> = { name: m.name };
  if (m.maxInputTokens || m.maxOutputTokens) {
    entry.limit = { context: m.maxInputTokens ?? 0, output: m.maxOutputTokens ?? 0 };
  }
  if (m.supportsToolCall) entry.tool_call = true;
  if (m.supportsImages) entry.attachment = true;
  return entry;
}

// 按指定服务器拉取 craft agent 可用模型（列表本身，不保证该服务器后端可跑全部模型）
async function fetchCraftModels(
  accessToken: string,
  serverUrl: string,
  domain: string,
): Promise<RemoteModel[]> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    Authorization: `Bearer ${accessToken}`,
    "X-Agent-Intent": CONFIG.agentIntent,
    "X-IDE-Type": CONFIG.ideType,
    "X-IDE-Name": CONFIG.ideName,
    "X-IDE-Version": CONFIG.ideVersion,
    "X-Product-Version": CONFIG.appVersion,
    "X-Env-ID": CONFIG.envId,
    "X-Domain": domain,
    "X-Product": CONFIG.product,
    "User-Agent": `${CONFIG.ideName}/${CONFIG.ideVersion} CodeBuddy/${CONFIG.appVersion}`,
  };
  const resp = await fetch(`${serverUrl}/v3/config`, { headers });
  if (!resp.ok) return [];
  const body = (await resp.json()) as RemoteConfigResponse;
  if (body.code !== 0 || !body.data) return [];
  const allModels = body.data.models || [];
  const modelMap = new Map(allModels.map((m) => [m.id, m]));
  const craftAgent = (body.data.agents || []).find((a) => a.name === CONFIG.agentIntent);
  const craftIds = craftAgent?.models || [];
  return craftIds.map((id) => modelMap.get(id)).filter((m): m is RemoteModel => !!m?.supportsToolCall);
}

async function fetchRemoteModels(
  accessToken: string,
  supplement: RemoteModel[],
): Promise<RemoteModel[]> {
  const primary = await fetchCraftModels(accessToken, resolvedServerUrl, resolvedDomain);
  if (primary.length === 0) return [DEFAULT_MODEL];
  let result = primary;
  // 国际端点列表里含 gpt-5.6/gemini 等国内端点 craft 列表未暴露的模型；
  // 这些模型在国内端点后端同样可用（已实测），故合并补充。若主端点已是国际版则无需合并。
  if (!resolvedServerUrl.includes("codebuddy.ai")) {
    const intl = await fetchCraftModels(
      accessToken,
      "https://www.codebuddy.ai",
      "www.codebuddy.ai",
    );
    const merged = new Map([...intl, ...primary].map((m) => [m.id, m]));
    result = [...merged.values()];
  }
  // 补充 /v3/config 未暴露、但后端实测可用的模型（默认 claude 清单或用户 extraModels 配置）
  const seen = new Set(result.map((m) => m.id));
  for (const m of supplement) {
    if (!seen.has(m.id)) result.push(m);
  }
  return result;
}

function generateUuid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(Buffer.from(payload + pad, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function resolveTenantId(accessToken: string): string {
  if (CONFIG.tenantId) return CONFIG.tenantId;
  const p = decodeJwtPayload(accessToken);
  if (!p) return "";
  const iss = p.iss || "";
  const m = iss.match(/realms\/sso-([^/]+)$/);
  return p.tenant_id || p.tenantId || (m?.[1] || "");
}

function resolveEnterpriseId(accessToken: string): string {
  if (CONFIG.enterpriseId) return CONFIG.enterpriseId;
  const p = decodeJwtPayload(accessToken);
  if (!p) return "";
  const roles = p.realm_access?.roles || p.resource_access?.account?.roles;
  if (roles) {
    for (const r of roles) {
      const m = r.match(/group-admin:([A-Za-z0-9-]+)/);
      if (m?.[1]) return m[1];
    }
  }
  return p.enterprise_id || p.enterpriseId || p.ent_id || p.entId || "";
}

function resolveUserId(accessToken: string): string {
  if (CONFIG.userId) return CONFIG.userId;
  const p = decodeJwtPayload(accessToken);
  return p?.user_id || p?.userId || p?.uid || p?.sub || "";
}

function resolveModel(inputModel?: string): string {
  if (CONFIG.defaultModel) return CONFIG.defaultModel;
  return inputModel || "";
}

function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function getHeader(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers;
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      if (key.toLowerCase() === lower) return value;
    }
    return undefined;
  }
  const record = headers as Record<string, string>;
  return record[record[name] !== undefined ? name : lower];
}

function buildAuthHeaders(
  accessToken: string,
  modelId?: string,
  conversationIdOverride?: string,
): Record<string, string> {
  const tenantId = resolveTenantId(accessToken);
  const enterpriseId = resolveEnterpriseId(accessToken);
  const userId = resolveUserId(accessToken);
  // 同一会话内复用 chat.headers 注入的会话级 conversation id，否则每次请求新建
  const conversationId = conversationIdOverride ?? generateTraceId();
  const messageId = generateTraceId();
  const traceId = generateTraceId();
  const spanId = generateTraceId().slice(0, 16);
  const parentSpanId = generateTraceId().slice(0, 16);

  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    Authorization: `Bearer ${accessToken}`,
    "X-Request-ID": messageId,
    "X-Conversation-ID": conversationId,
    "X-Conversation-Request-ID": messageId,
    "X-Conversation-Message-ID": messageId,
    "X-Agent-Intent": CONFIG.agentIntent,
    "X-IDE-Type": CONFIG.ideType,
    "X-IDE-Name": CONFIG.ideName,
    "X-IDE-Version": CONFIG.ideVersion,
    "X-Product-Version": CONFIG.appVersion,
    "X-Request-Trace-Id": traceId,
    "X-Env-ID": CONFIG.envId,
    "X-Domain": resolvedDomain,
    "X-Product": CONFIG.product,
    "User-Agent": `${CONFIG.ideName}/${CONFIG.ideVersion} CodeBuddy/${CONFIG.appVersion}`,
    b3: `${traceId}-${spanId}-1-${parentSpanId}`,
    "X-B3-TraceId": traceId,
    "X-B3-ParentSpanId": parentSpanId,
    "X-B3-SpanId": spanId,
    "X-B3-Sampled": "1",
  };

  if (tenantId) headers["X-Tenant-Id"] = tenantId;
  if (enterpriseId) headers["X-Enterprise-Id"] = enterpriseId;
  if (userId) headers["X-User-Id"] = userId;
  if (modelId) headers["X-Model-ID"] = modelId;

  return headers;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestAuthState(): Promise<{ state: string; url: string }> {
  const params = new URLSearchParams({ platform: CONFIG.platform, ioa: "1" });
  const response = await fetch(
    `${resolvedServerUrl}/v2/plugin/auth/state?${params.toString()}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-No-Authorization": "true",
        "X-No-User-Id": "true",
        "X-No-Enterprise-Id": "true",
        "X-No-Department-Info": "true",
      },
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Auth state request failed: ${response.status} - ${text}`);
  }
  const data = (await response.json()) as AuthStateResponse;
  if (data.code !== 0 || !data.data?.state) {
    throw new Error(`Invalid auth state response: ${JSON.stringify(data)}`);
  }
  const loginUrl =
    data.data.authUrl ||
    `${resolvedServerUrl}/login?platform=${CONFIG.platform}&state=${data.data.state}&ioa=1`;
  return { state: data.data.state, url: loginUrl };
}

async function pollForToken(
  state: string,
  expiresAt: number,
  signal?: AbortSignal,
): Promise<TokenPollResponse["data"] | null> {
  while (Date.now() < expiresAt) {
    if (signal?.aborted) return null;
    await sleep(3000);
    try {
      const response = await fetch(
        `${resolvedServerUrl}/v2/plugin/auth/token?state=${state}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-No-Authorization": "true",
            "X-No-User-Id": "true",
            "X-No-Enterprise-Id": "true",
            "X-No-Department-Info": "true",
          },
          signal,
        },
      );
      if (response.ok) {
        const data = (await response.json()) as TokenPollResponse;
        if (data.code === 0 && data.data?.accessToken) return data.data;
      }
    } catch {
      if (signal?.aborted) return null;
    }
  }
  return null;
}

async function refreshAccessToken(
  refreshToken: string,
): Promise<RefreshResponse["data"] | null> {
  try {
    const response = await fetch(
      `${resolvedServerUrl}/v2/plugin/auth/token/refresh`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${refreshToken}`,
        },
      },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as RefreshResponse;
    if (data.code !== 0) return null;
    return data.data || null;
  } catch {
    return null;
  }
}

// CodeBuddy 后端在每一帧 SSE 中都下发 `tool_calls: []`（空数组，非 null）。
// @ai-sdk/openai-compatible 对任何非 null 的 tool_calls 都会触发 reasoning-end，
// 导致逐词碎片化的 thinking 块。这里把空数组归一为 null，使连续推理累积成单个块。
function coalesceStream(response: Response): Response {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  const stream = response.body!.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.startsWith("data:")) {
            const payload = line.slice(5).trim();
            if (payload && payload !== "[DONE]") {
              try {
                const obj = JSON.parse(payload);
                const delta = obj?.choices?.[0]?.delta;
                if (
                  delta &&
                  Array.isArray(delta.tool_calls) &&
                  delta.tool_calls.length === 0
                ) {
                  delta.tool_calls = null;
                }
                controller.enqueue(encoder.encode(`data:${JSON.stringify(obj)}\n`));
                continue;
              } catch {}
            }
          }
          controller.enqueue(encoder.encode(line + "\n"));
        }
      },
      flush(controller) {
        if (buffer) controller.enqueue(encoder.encode(buffer));
      },
    }),
  );
  return new Response(stream, { status: response.status, headers });
}

export const CodeBuddyAuthPlugin: Plugin = async (input, options) => {
  const settings = (options ?? {}) as PluginSettings;
  const supplement = Array.isArray(settings.extraModels)
    ? settingsToRemoteModels(settings.extraModels)
    : EXTRA_MODELS;
  return {
    async config(config) {
      if (!config.provider) config.provider = {};
      if (!config.provider[PROVIDER_ID]) {
        config.provider[PROVIDER_ID] = {
          npm: "@ai-sdk/openai-compatible",
          name: "CodeBuddy",
          options: {
            baseURL: `${resolvedServerUrl}/v2`,
            setCacheKey: true,
          },
          models: {},
        };
      }
      const provider = config.provider[PROVIDER_ID] as
        | Record<string, unknown>
        | undefined;
      if (!provider) return;
      const opts = (provider.options || {}) as Record<string, unknown>;
      const configuredBase = typeof opts.baseURL === "string" ? opts.baseURL : undefined;
      if (configuredBase) {
        try {
          const u = new URL(configuredBase);
          resolvedServerUrl = `${u.protocol}//${u.host}`;
          resolvedDomain = resolvedServerUrl.includes("codebuddy.ai")
            ? "www.codebuddy.ai"
            : "www.codebuddy.cn";
        } catch {}
      }
      if (!provider.models) {
        provider.models = {};
      }
      const models = provider.models as Record<string, unknown>;

      let discovered: RemoteModel[] = [];
      try {
        const home = os.homedir();
        const authPath = path.join(home, ".local", "share", "opencode", "auth.json");
        const raw = fs.readFileSync(authPath, "utf8");
        const all = JSON.parse(raw) as Record<string, { type: string; access?: string }>;
        const auth = all[PROVIDER_ID];
        if (auth?.type === "oauth" && auth.access) {
          const work = fetchRemoteModels(auth.access, supplement);
          discovered = await Promise.race([
            work,
            new Promise<RemoteModel[]>((resolve) =>
              setTimeout(() => resolve([]), DISCOVERY_TIMEOUT_MS),
            ),
          ]);
        }
      } catch {
        // auth not available yet, use fallback
      }

      if (discovered.length === 0) {
        discovered = [DEFAULT_MODEL];
      }

      for (const m of discovered) {
        if (models[m.id]) continue;
        models[m.id] = remoteModelToConfig(m);
      }
    },
    auth: {
      provider: PROVIDER_ID,
      async loader(getAuth, _provider) {
        return {
          apiKey: "cli-proxy",
          baseURL: resolvedServerUrl,
          async fetch(
            url: RequestInfo | URL,
            init?: RequestInit,
          ): Promise<Response> {
            const urlStr = url.toString();
            if (!urlStr.includes("/chat/completions")) {
              return fetch(url, init);
            }

            const currentAuth = await getAuth();
            if (currentAuth.type !== "oauth" || !currentAuth.access) {
              throw new Error("缺少 access token，请重新登录");
            }

            let accessToken = currentAuth.access;
            const body = init?.body;
            if (!body) {
              return new Response(
                JSON.stringify({ error: "Missing request body" }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json" },
                },
              );
            }

            const openaiRequest = JSON.parse(
              typeof body === "string"
                ? body
                : await new Response(body).text(),
            ) as OpenAIRequest;

            const resolvedModel = resolveModel(openaiRequest.model);
            if (!resolvedModel) {
              throw new Error(
                "未设置模型，请设置 CODEBUDDY_DEFAULT_MODEL 或在 OpenCode 选择模型",
              );
            }

            const requestBody: OpenAIRequest = {
              ...openaiRequest,
              model: resolvedModel,
              stream: openaiRequest.stream ?? true,
            };
            if (openaiRequest.response_format) {
              requestBody.response_format = openaiRequest.response_format;
            }

            // chat.headers hook 为本次请求注入了会话级 conversation id（session → id 映射），
            // 拦截层从这里取回复用；取不到时退回每次请求随机生成（旧行为）。
            const conversationId = getHeader(init, "x-conversation-id");

            const doRequest = async (token: string) => {
              return fetch(
                `${resolvedServerUrl}${CONFIG.chatCompletionsPath}`,
                {
                  method: "POST",
                  headers: buildAuthHeaders(token, resolvedModel, conversationId),
                  body: JSON.stringify(requestBody),
                },
              );
            };

            let response = await doRequest(accessToken);

            if (
              (response.status === 401 || response.status === 403) &&
              currentAuth.refresh
            ) {
              console.log("[codebuddy] Token expired, attempting refresh...");
              const refreshed = await refreshAccessToken(currentAuth.refresh);
              if (refreshed?.accessToken) {
                accessToken = refreshed.accessToken;
                const newExpires = refreshed.expiresIn
                  ? Date.now() + refreshed.expiresIn * 1000
                  : Date.now() + 24 * 60 * 60 * 1000;
                await input.client.auth.set({
                  path: { id: PROVIDER_ID },
                  body: {
                    type: "oauth",
                    access: refreshed.accessToken,
                    refresh: refreshed.refreshToken || currentAuth.refresh,
                    expires: newExpires,
                  },
                });
                response = await doRequest(accessToken);
              }
            }

            if (!response.ok) {
              const errorText = await response.text();
              console.error(
                `[codebuddy] API error: ${response.status} - ${errorText}`,
              );
              return new Response(errorText, {
                status: response.status,
                headers: { "Content-Type": "application/json" },
              });
            }

            return coalesceStream(response);
          },
        };
      },
      methods: [
        {
          label: "IOA 登录 (浏览器)",
          type: "oauth",
          async authorize() {
            const authState = await requestAuthState();
            const expiresAt = Date.now() + 10 * 60 * 1000;
            return {
              url: authState.url,
              instructions: "请在浏览器中完成 IOA 登录",
              method: "auto" as const,
              async callback() {
                const tokenData = await pollForToken(
                  authState.state,
                  expiresAt,
                );
                if (!tokenData) return { type: "failed" as const };
                return {
                  type: "success" as const,
                  access: tokenData.accessToken,
                  refresh: tokenData.refreshToken || "",
                  expires: tokenData.expiresIn
                    ? Date.now() + tokenData.expiresIn * 1000
                    : Date.now() + 24 * 60 * 60 * 1000,
                };
              },
            };
          },
        },
      ],
    },
    async "chat.params"(input, output) {
      if (input.model.providerID !== PROVIDER_ID) return;
      output.options.baseURL = resolvedServerUrl;
    },
    // 让 CodeBuddy 网关的前缀缓存能跨请求命中：同一 opencode session 复用同一
    // X-Conversation-ID（由 auth loader 的拦截层读取后注入请求头）。
    async "chat.headers"(input, output) {
      if (input.model.providerID !== PROVIDER_ID) return;
      output.headers["X-Conversation-ID"] = conversationIdForSession(input.sessionID);
    },
  } satisfies Hooks;
};

export default {
  id: "codebuddy-auth",
  server: CodeBuddyAuthPlugin,
};
