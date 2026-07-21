export type Feedback = { overall_summary: string; strengths: string[]; weaknesses: string[]; recommendations: string[]; keyword_suggestions: string[]; resume_rewrite_suggestions: string[]; missing_skills: string[]; interview_preparation: string[] };
export type ReviewResult = { resume: { name?: string; skills: string[]; experience: unknown[]; education: unknown[]; projects: unknown[] }; ats_result: { overall_score: number; breakdown: Record<string, number>; matched_skills: string[]; missing_skills: string[] }; feedback: Feedback; provider_response: { provider: string; model: string } };

export async function createReview(data: { file: File; jobDescription: string; promptType: string; provider: string; model?: string; additionalContext?: string }): Promise<ReviewResult> {
  const body = new FormData();
  body.set("resume", data.file); body.set("job_description", data.jobDescription); body.set("prompt_type", data.promptType); body.set("provider", data.provider); if (data.model) body.set("model", data.model); if (data.additionalContext) body.set("additional_context", data.additionalContext);
  const response = await fetch("http://127.0.0.1:8000/api/v1/reviews", { method: "POST", body });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.detail ?? "Unable to analyze this resume.");
  return response.json();
}
