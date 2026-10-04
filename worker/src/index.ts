/**
 * Cloudflare Worker: serves the static Next.js frontend and the /api/v1 review endpoints.
 * Pipeline mirrors backend/app/services/review_service.py: parse → ATS → prompt → LLM → normalize.
 */

import { scoreResume } from "./ats";
import { buildRepairPrompt, FeedbackParseError, parseFeedback, removePresentSkills } from "./feedback";
import { parseResume, ResumeParseError } from "./parser";
import { buildPrompt } from "./prompts";
import { generate, listProviders, providerChain, ProviderError, type Env } from "./providers";
import { PROMPT_TYPES, type PromptType, type ReviewResult } from "./types";

const MAX_RESUME_CHARS = 60_000;
const MAX_JOB_DESCRIPTION_CHARS = 20_000;
const MAX_CONTEXT_CHARS = 4_000;
const MAX_OUTPUT_TOKENS = 2_000;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type ReviewInput = {
  resume_text: string;
  filename?: string | null;
  job_description: string;
  prompt_type?: PromptType;
  provider?: string | null;
  model?: string | null;
  additional_context?: string | null;
};

function readInput(body: unknown): ReviewInput {
  if (!body || typeof body !== "object") throw new HttpError(400, "Request body must be a JSON object");
  const input = body as Record<string, unknown>;
  const text = (key: string, max: number, required = false, min = 0): string | null => {
    const value = input[key];
    if (value === undefined || value === null || value === "") {
      if (required) throw new HttpError(422, `${key} is required`);
      return null;
    }
    if (typeof value !== "string") throw new HttpError(422, `${key} must be a string`);
    const trimmed = value.trim();
    if (trimmed.length < min) throw new HttpError(422, `${key} must contain at least ${min} characters`);
    if (trimmed.length > max) throw new HttpError(413, `${key} must not exceed ${max} characters`);
    return trimmed;
  };
  const promptType = (text("prompt_type", 40) ?? "resume_review") as PromptType;
  if (!PROMPT_TYPES.includes(promptType)) throw new HttpError(422, `prompt_type must be one of: ${PROMPT_TYPES.join(", ")}`);
  return {
    resume_text: text("resume_text", MAX_RESUME_CHARS, true, 1)!,
    filename: text("filename", 255),
    job_description: text("job_description", MAX_JOB_DESCRIPTION_CHARS, true, 20)!,
    prompt_type: promptType,
    provider: text("provider", 40),
    model: text("model", 120),
    additional_context: text("additional_context", MAX_CONTEXT_CHARS),
  };
}

async function review(env: Env, input: ReviewInput): Promise<ReviewResult> {
  const resume = parseResume(input.resume_text, input.filename ?? null);
  const atsResult = scoreResume(resume, input.job_description);
  const prompt = buildPrompt({
    promptType: input.prompt_type ?? "resume_review",
    resume,
    atsResult,
    jobDescription: input.job_description,
    additionalContext: input.additional_context,
  });
  const chain = providerChain(env, input.provider);
  // A model override only makes sense for an explicitly chosen provider.
  const model = chain.length === 1 && input.provider && input.provider !== "auto" ? input.model ?? undefined : undefined;

  const failures: string[] = [];
  for (const name of chain) {
    try {
      const request = { ...prompt, model, temperature: 0, maxTokens: MAX_OUTPUT_TOKENS };
      let response = await generate(env, name, request);
      let feedback;
      try {
        feedback = parseFeedback(response.content);
      } catch (error) {
        if (!(error instanceof FeedbackParseError)) throw error;
        const repair = buildRepairPrompt(response.content, prompt.systemPrompt, prompt.userPrompt);
        response = await generate(env, name, { ...request, ...repair });
        feedback = parseFeedback(response.content);
      }
      return { resume, ats_result: atsResult, feedback: removePresentSkills(feedback, resume), provider_response: response };
    } catch (error) {
      if (!(error instanceof ProviderError || error instanceof FeedbackParseError)) throw error;
      console.warn("provider_failed", name, error.message);
      failures.push(`${name}: ${error.message}`);
    }
  }
  throw new HttpError(502, `AI provider request failed (${failures.join(" | ")})`);
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000").split(",").map((item) => item.trim());
  if (!origin || !allowed.includes(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" };
}

function json(data: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  const cors = corsHeaders(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    if (path === "/api/v1/health" && request.method === "GET") return json({ status: "ok" }, 200, cors);
    if (path === "/api/v1/providers" && request.method === "GET") return json({ default: env.AI_PROVIDER || "auto", providers: listProviders(env) }, 200, cors);
    if (path === "/api/v1/reviews" && request.method === "POST") {
      const body = await request.json().catch(() => {
        throw new HttpError(400, "Request body must be valid JSON");
      });
      return json(await review(env, readInput(body)), 200, cors);
    }
    return json({ detail: "Not found" }, 404, cors);
  } catch (error) {
    if (error instanceof HttpError) return json({ detail: error.message }, error.status, cors);
    if (error instanceof ResumeParseError) return json({ detail: error.message }, 422, cors);
    if (error instanceof ProviderError) return json({ detail: error.message }, error.status && error.status < 500 ? error.status : 502, cors);
    console.error("unhandled_error", error);
    return json({ detail: "Internal server error" }, 500, cors);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/")) return handleApi(request, env, path);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
