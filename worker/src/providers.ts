/**
 * Free-tier LLM providers. Every adapter normalizes to ProviderResponse, and `auto` walks the
 * configured providers in order so an exhausted daily quota (HTTP 429) falls through to the next.
 */

import { usage, type ProviderRequest, type ProviderResponse, type TokenUsage } from "./types";

export type Env = {
  ASSETS: Fetcher;
  AI?: Ai;
  AI_PROVIDER?: string;
  ALLOWED_ORIGINS?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  WORKERS_AI_MODEL?: string;
};

export const PROVIDER_NAMES = ["gemini", "groq", "openrouter", "workers-ai"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

type Provider = {
  name: ProviderName;
  label: string;
  defaultModel: (env: Env) => string;
  configured: (env: Env) => boolean;
  generate: (env: Env, request: ProviderRequest, model: string) => Promise<{ content: string; usage: TokenUsage }>;
};

const REQUEST_TIMEOUT_MS = 60_000;

async function postJson(url: string, headers: Record<string, string>, body: unknown, provider: string): Promise<any> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ProviderError(`${provider} request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    const reason = response.status === 429 ? "free quota or rate limit reached" : `status ${response.status}`;
    throw new ProviderError(`${provider} failed: ${reason} ${detail}`.trim(), response.status);
  }
  return response.json();
}

function chatMessages(request: ProviderRequest) {
  return [
    { role: "system", content: request.systemPrompt },
    { role: "user", content: request.userPrompt },
  ];
}

function openAICompatible(name: ProviderName, label: string, endpoint: string, keyName: "GROQ_API_KEY" | "OPENROUTER_API_KEY", modelName: "GROQ_MODEL" | "OPENROUTER_MODEL", fallbackModel: string, extraHeaders: Record<string, string> = {}): Provider {
  return {
    name,
    label,
    defaultModel: (env) => env[modelName] || fallbackModel,
    configured: (env) => Boolean(env[keyName]),
    async generate(env, request, model) {
      const payload = await postJson(
        endpoint,
        { Authorization: `Bearer ${env[keyName]}`, ...extraHeaders },
        {
          model,
          messages: chatMessages(request),
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          response_format: { type: "json_object" },
        },
        name,
      );
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new ProviderError(`${name} returned non-text content`);
      return { content, usage: usage(payload.usage?.prompt_tokens ?? 0, payload.usage?.completion_tokens ?? 0) };
    },
  };
}

const PROVIDERS: Record<ProviderName, Provider> = {
  gemini: {
    name: "gemini",
    label: "Google Gemini (free tier)",
    defaultModel: (env) => env.GEMINI_MODEL || "gemini-flash-latest",
    configured: (env) => Boolean(env.GEMINI_API_KEY),
    async generate(env, request, model) {
      const payload = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { "x-goog-api-key": env.GEMINI_API_KEY! },
        {
          systemInstruction: { parts: [{ text: request.systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: request.userPrompt }] }],
          generationConfig: { temperature: request.temperature, maxOutputTokens: request.maxTokens, responseMimeType: "application/json" },
        },
        "gemini",
      );
      const parts: Array<{ text?: string; thought?: boolean }> = payload?.candidates?.[0]?.content?.parts ?? [];
      const content = parts.filter((part) => !part.thought && typeof part.text === "string").map((part) => part.text).join("");
      if (!content) throw new ProviderError(`gemini returned no text (finishReason: ${payload?.candidates?.[0]?.finishReason ?? "unknown"})`);
      const meta = payload.usageMetadata ?? {};
      return { content, usage: usage(meta.promptTokenCount ?? 0, meta.candidatesTokenCount ?? 0) };
    },
  },
  groq: openAICompatible("groq", "Groq (free tier)", "https://api.groq.com/openai/v1/chat/completions", "GROQ_API_KEY", "GROQ_MODEL", "llama-3.3-70b-versatile"),
  openrouter: openAICompatible(
    "openrouter",
    "OpenRouter (free models)",
    "https://openrouter.ai/api/v1/chat/completions",
    "OPENROUTER_API_KEY",
    "OPENROUTER_MODEL",
    "meta-llama/llama-3.3-70b-instruct:free",
    { "X-Title": "ResumeLens AI" },
  ),
  "workers-ai": {
    name: "workers-ai",
    label: "Cloudflare Workers AI (free 10k neurons/day)",
    defaultModel: (env) => env.WORKERS_AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    configured: (env) => Boolean(env.AI),
    async generate(env, request, model) {
      let result: any;
      try {
        result = await env.AI!.run(model as any, {
          messages: chatMessages(request),
          temperature: request.temperature,
          max_tokens: request.maxTokens,
        } as any);
      } catch (error) {
        throw new ProviderError(`workers-ai failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      const raw = result?.response;
      const content = typeof raw === "string" ? raw : raw && typeof raw === "object" ? JSON.stringify(raw) : "";
      if (!content) throw new ProviderError("workers-ai returned no text");
      return { content, usage: usage(result?.usage?.prompt_tokens ?? 0, result?.usage?.completion_tokens ?? 0) };
    },
  },
};

export function isProviderName(value: string): value is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(value);
}

export function listProviders(env: Env) {
  return PROVIDER_NAMES.map((name) => ({
    name,
    label: PROVIDERS[name].label,
    configured: PROVIDERS[name].configured(env),
    default_model: PROVIDERS[name].defaultModel(env),
  }));
}

/** Resolve which providers to try, in order, for a requested name or `auto`. */
export function providerChain(env: Env, requested?: string | null): ProviderName[] {
  const choice = (requested || env.AI_PROVIDER || "auto").toLowerCase();
  if (choice !== "auto") {
    if (!isProviderName(choice)) throw new ProviderError(`Unknown provider: ${choice}`, 400);
    if (!PROVIDERS[choice].configured(env)) throw new ProviderError(`Provider ${choice} is not configured on this deployment`, 400);
    return [choice];
  }
  const chain = PROVIDER_NAMES.filter((name) => PROVIDERS[name].configured(env));
  if (!chain.length) throw new ProviderError("No AI provider is configured. Add an API key secret or the Workers AI binding.", 503);
  return chain;
}

export async function generate(env: Env, name: ProviderName, request: ProviderRequest): Promise<ProviderResponse> {
  const provider = PROVIDERS[name];
  const model = request.model || provider.defaultModel(env);
  const { content, usage: tokens } = await provider.generate(env, request, model);
  return { provider: name, model, content, usage: tokens, generated_at: new Date().toISOString() };
}
