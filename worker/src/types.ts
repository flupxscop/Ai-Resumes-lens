/** Frontend-facing contracts mirrored from backend/app/models/schemas.py. */

export type Contact = {
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
};

export type Education = {
  institution: string;
  degree: string | null;
  field_of_study: string | null;
  start_date: string | null;
  end_date: string | null;
  grade: string | null;
};

export type Experience = {
  company: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  description: string[];
  skills: string[];
};

export type Project = { name: string; description: string[]; technologies: string[]; url: string | null };

export type Certification = { name: string; issuer: string | null; issued_date: string | null; credential_id: string | null };

export type Resume = {
  name: string | null;
  contact: Contact;
  summary: string | null;
  skills: string[];
  education: Education[];
  experience: Experience[];
  projects: Project[];
  certifications: Certification[];
  sections: Record<string, string>;
  raw_text: string;
  source_filename: string | null;
};

export type ScoreBreakdown = {
  keyword_score: number;
  skill_score: number;
  experience_score: number;
  education_score: number;
  project_score: number;
  formatting_score: number;
  grammar_score: number;
  achievement_score: number;
};

export type ATSResult = {
  overall_score: number;
  breakdown: ScoreBreakdown;
  matched_keywords: string[];
  missing_keywords: string[];
  matched_skills: string[];
  missing_skills: string[];
  improvement_notes: string[];
};

export const PROMPT_TYPES = ["resume_review", "cover_letter", "interview_prep", "career_advice"] as const;
export type PromptType = (typeof PROMPT_TYPES)[number];

export type Feedback = {
  overall_summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  keyword_suggestions: string[];
  resume_rewrite_suggestions: string[];
  missing_skills: string[];
  interview_preparation: string[];
};

export type TokenUsage = { prompt_tokens: number; completion_tokens: number; total_tokens: number };

export type ProviderRequest = {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature: number;
  maxTokens: number;
};

export type ProviderResponse = {
  provider: string;
  model: string;
  content: string;
  usage: TokenUsage;
  generated_at: string;
};

export type ReviewResult = {
  resume: Resume;
  ats_result: ATSResult;
  feedback: Feedback;
  provider_response: ProviderResponse;
};

export function usage(prompt = 0, completion = 0): TokenUsage {
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
}
