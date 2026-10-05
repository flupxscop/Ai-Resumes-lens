/** Normalize provider output into the feedback contract (backend/app/response/parser.py). */

import type { Feedback, Resume } from "./types";

export class FeedbackParseError extends Error {}

const LIST_FIELDS = [
  "strengths",
  "weaknesses",
  "recommendations",
  "keyword_suggestions",
  "resume_rewrite_suggestions",
  "missing_skills",
  "interview_preparation",
] as const;
const REQUIRED_LIST_FIELDS = LIST_FIELDS.filter((field) => field !== "missing_skills");
const FIELDS = new Set<string>(["overall_summary", ...LIST_FIELDS]);
const ALIASES: Record<string, string> = {
  summary: "overall_summary",
  "overall summary": "overall_summary",
  keywords: "keyword_suggestions",
  "resume rewrites": "resume_rewrite_suggestions",
  "rewrite suggestions": "resume_rewrite_suggestions",
  "interview prep": "interview_preparation",
  "interview preparation": "interview_preparation",
};
const TEXT_HEADINGS: Record<string, (typeof LIST_FIELDS)[number]> = {
  strengths: "strengths",
  weaknesses: "weaknesses",
  recommendations: "recommendations",
  "keyword suggestions": "keyword_suggestions",
  "resume rewrite suggestions": "resume_rewrite_suggestions",
  "missing skills": "missing_skills",
  "interview preparation": "interview_preparation",
};

export function parseFeedback(content: string): Feedback {
  const payload = parseJson(content);
  if (payload === null) return validate(parseText(content));
  const normalized = normalizePayload(payload);
  if (!LIST_FIELDS.some((field) => field in normalized)) {
    throw new FeedbackParseError("Provider JSON does not match the feedback contract");
  }
  return validate(normalized);
}

function validate(candidate: Record<string, unknown>): Feedback {
  const feedback = {
    overall_summary: String(candidate.overall_summary ?? "").trim(),
    ...Object.fromEntries(
      LIST_FIELDS.map((field) => [field, ((candidate[field] as string[] | undefined) ?? []).map((item) => item.trim()).filter(Boolean)]),
    ),
  } as Feedback;
  if (!feedback.overall_summary) throw new FeedbackParseError("Feedback is missing overall_summary");
  for (const field of REQUIRED_LIST_FIELDS) {
    if (feedback[field].length < 2) throw new FeedbackParseError(`Feedback field ${field} needs at least two items`);
  }
  return feedback;
}

function parseJson(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const candidates = [trimmed, ...[...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)].map((match) => match[1])];
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const payload = JSON.parse(candidate);
      if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload as Record<string, unknown>;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function normalizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const snakeKey = key.replace(/(?<!^)(?=[A-Z])/g, "_").toLowerCase().replace(/-/g, "_").trim();
    const canonical = ALIASES[snakeKey.replace(/_/g, " ")] ?? snakeKey;
    if (!FIELDS.has(canonical)) continue;
    if (canonical === "overall_summary") normalized[canonical] = String(value);
    else if (Array.isArray(value)) normalized[canonical] = value.map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
    else normalized[canonical] = [String(value)];
  }
  normalized.overall_summary ??= "The provider did not return a structured summary.";
  return normalized;
}

function parseText(content: string): Record<string, unknown> {
  const cleaned = content.replace(/```(?:json)?|```/gi, "").trim();
  if (!cleaned) throw new FeedbackParseError("Provider returned an empty response");
  const sections: Record<string, string[]> = { overall_summary: [] };
  let current = "overall_summary";
  for (const rawLine of cleaned.split("\n")) {
    const line = rawLine.trim();
    const heading = TEXT_HEADINGS[line.replace(/:+$/, "").toLowerCase()];
    if (heading) {
      current = heading;
      sections[current] ??= [];
    } else if (line) (sections[current] ??= []).push(line.replace(/^[•\-* ]+/, ""));
  }
  const { overall_summary: summary, ...rest } = sections;
  return { overall_summary: summary.join(" ") || cleaned, ...rest };
}

export function buildRepairPrompt(content: string, systemPrompt: string, userPrompt: string): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt:
      "Return only a JSON object with exactly these keys: overall_summary, strengths, " +
      "weaknesses, recommendations, keyword_suggestions, resume_rewrite_suggestions, " +
      "missing_skills, interview_preparation. overall_summary must be a string; every " +
      "other key must be an array of strings. strengths, weaknesses, recommendations, " +
      "keyword_suggestions, resume_rewrite_suggestions, and interview_preparation must " +
      "each contain at least two specific items. Do not extract or return resume fields.",
    userPrompt:
      "Use the original task context below as the only source of truth. Return useful, " +
      "specific feedback; do not claim that a skill already present in the parsed resume " +
      "is missing.\n\n" +
      `Original system instructions:\n${systemPrompt}\n\n` +
      `Original task context:\n${userPrompt}\n\n` +
      `Previous invalid response to replace:\n${content}`,
  };
}

const skillKey = (value: string) => value.toLowerCase().replace(/\([^)]*\)|[^a-z0-9+# ]/g, "").trim();

/** Prevent provider hallucinations from marking documented skills as missing. */
export function removePresentSkills(feedback: Feedback, resume: Resume): Feedback {
  const known = new Set([...resume.skills, ...resume.raw_text.split("\n")].map(skillKey).filter(Boolean));
  const missing = feedback.missing_skills.filter((skill) => {
    const candidate = skillKey(skill);
    if (!candidate) return true;
    for (const item of known) if (candidate === item || item.includes(candidate) || candidate.includes(item)) return false;
    return true;
  });
  return { ...feedback, missing_skills: missing };
}
