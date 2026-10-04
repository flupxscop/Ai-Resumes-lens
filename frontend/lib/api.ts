import { extractResumeText } from "./extract";

export type Feedback = { overall_summary: string; strengths: string[]; weaknesses: string[]; recommendations: string[]; keyword_suggestions: string[]; resume_rewrite_suggestions: string[]; missing_skills: string[]; interview_preparation: string[] };
export type ReviewResult = { resume: { name?: string; skills: string[]; experience: unknown[]; education: unknown[]; projects: unknown[] }; ats_result: { overall_score: number; breakdown: Record<string, number>; matched_skills: string[]; missing_skills: string[] }; feedback: Feedback; provider_response: { provider: string; model: string } };
export type ProviderInfo = { name: string; label: string; configured: boolean; default_model: string };

// Same-origin in production (the Worker serves both); override for `next dev` against `wrangler dev`.
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

export async function listProviders(): Promise<ProviderInfo[]> {
  const response = await fetch(`${API_BASE}/api/v1/providers`);
  if (!response.ok) return [];
  return (await response.json()).providers ?? [];
}

export async function createReview(data: { file: File; jobDescription: string; promptType: string; provider: string; model?: string; additionalContext?: string }): Promise<ReviewResult> {
  const resumeText = await extractResumeText(data.file);
  const response = await fetch(`${API_BASE}/api/v1/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resume_text: resumeText,
      filename: data.file.name,
      job_description: data.jobDescription,
      prompt_type: data.promptType,
      provider: data.provider,
      model: data.model || undefined,
      additional_context: data.additionalContext || undefined,
    }),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.detail ?? "Unable to analyze this resume.");
  return response.json();
}
