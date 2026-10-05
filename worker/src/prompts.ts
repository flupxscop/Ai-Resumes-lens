/** Provider-neutral prompt strategies ported from backend/app/prompts/builder.py. */

import type { ATSResult, PromptType, Resume } from "./types";

const OUTPUT_CONTRACT = {
  overall_summary: "string",
  strengths: ["string"],
  weaknesses: ["string"],
  recommendations: ["string"],
  keyword_suggestions: ["string"],
  resume_rewrite_suggestions: ["string"],
  missing_skills: ["string"],
  interview_preparation: ["string"],
};

export const SYSTEM_PROMPT =
  "You are an expert career coach and ATS specialist. Be precise, constructive, " +
  "and truthful. Do not invent qualifications. Return only one valid JSON object with " +
  "exactly the following feedback fields. Never return parsed-resume fields such as " +
  "name, title, experience, education, or projects. Every field must exist. Never list " +
  "a skill as missing if it appears in the parsed resume. Make recommendations specific " +
  "to the supplied job description and resume evidence. You must provide at least two " +
  "specific items in strengths, weaknesses, recommendations, keyword_suggestions, " +
  "resume_rewrite_suggestions, and interview_preparation; do not return empty arrays " +
  "for these six fields: " +
  JSON.stringify(OUTPUT_CONTRACT);

const INSTRUCTIONS: Record<PromptType, string> = {
  resume_review:
    "Review this resume against the job description. Prioritize ATS alignment, factual " +
    "resume rewrites, missing skills, and the most impactful next actions.",
  cover_letter:
    "Create a tailored cover-letter plan grounded only in the supplied resume. In " +
    "resume_rewrite_suggestions, provide a concise draft outline and evidence to use.",
  interview_prep:
    "Prepare the candidate for interviews for this role. Put likely interview questions, " +
    "STAR-story angles, and knowledge gaps in interview_preparation.",
  career_advice:
    "Provide practical career advice based on the candidate's current profile and target " +
    "role. Recommend a prioritized, realistic growth plan.",
};

export type PromptInput = {
  promptType: PromptType;
  resume: Resume;
  atsResult: ATSResult;
  jobDescription: string;
  additionalContext?: string | null;
};

export function buildPrompt(input: PromptInput): { systemPrompt: string; userPrompt: string } {
  // `sections` duplicates raw_text, so it is left out to save free-tier tokens.
  const { sections: _sections, ...resume } = input.resume;
  const context =
    `Job description:\n${input.jobDescription}\n\n` +
    `Parsed resume:\n${JSON.stringify(resume, null, 2)}\n\n` +
    `ATS analysis:\n${JSON.stringify(input.atsResult, null, 2)}\n\n` +
    `Additional context:\n${input.additionalContext || "None"}`;
  return { systemPrompt: SYSTEM_PROMPT, userPrompt: `${INSTRUCTIONS[input.promptType]}\n\n${context}` };
}
