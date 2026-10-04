/** Deterministic ATS scoring ported from backend/app/ats/scoring.py. */

import type { ATSResult, Resume, ScoreBreakdown } from "./types";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "of",
  "on", "or", "the", "to", "with", "will", "you", "your", "we", "our", "this", "that",
  "have", "has", "using", "role", "work", "years", "experience", "required", "preferred",
  "into", "such", "building", "business", "knowledge", "solutions", "solution", "processes",
  "process", "technologies", "technology", "improvement", "key", "including", "across", "within",
  "applications", "data", "deployment", "engineering", "language", "monitoring", "performance",
  "requirements", "software", "tools", "model", "models", "responsibilities", "time",
]);
const SKILL_PATTERN = new RegExp(
  "\\b(?:python|java(?:script)?|typescript|sql|aws|azure|gcp|docker|kubernetes|" +
    "fastapi|django|flask|react|angular|vue|node(?:\\.js)?|postgres(?:ql)?|mongodb|redis|" +
    "machine learning|deep learning|nlp|spacy|pandas|tensorflow|pytorch|git|linux|graphql)\\b",
  "gi",
);
const ACHIEVEMENT_PATTERN = /(?:\d+(?:\.\d+)?\s*(?:%|\+)|\$[\d,.]+|\b(?:increased|reduced|saved|grew|improved|delivered|generated|executed|measured)\b)/i;

const WEIGHTS: Record<keyof ScoreBreakdown, number> = {
  keyword_score: 0.2,
  skill_score: 0.2,
  experience_score: 0.15,
  education_score: 0.1,
  project_score: 0.1,
  formatting_score: 0.1,
  grammar_score: 0.05,
  achievement_score: 0.1,
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const containsWord = (text: string, word: string) => new RegExp(`\\b${escapeRegex(word)}\\b`).test(text);
const ratio = (numerator: number, denominator: number, fallback = 0) => round2(denominator ? (numerator / denominator) * 100 : fallback);
const sorted = (values: Iterable<string>) => [...values].sort();

export function scoreResume(resume: Resume, jobDescription: string): ATSResult {
  if (!jobDescription.trim()) throw new Error("job_description cannot be empty");
  const resumeText = resume.raw_text.toLowerCase();
  const jobKeywords = keywords(jobDescription);
  const matchedKeywords = new Set([...jobKeywords].filter((keyword) => containsWord(resumeText, keyword)));
  const missingKeywords = [...jobKeywords].filter((keyword) => !matchedKeywords.has(keyword));
  const requiredSkills = skills(jobDescription);
  const resumeSkills = new Set([...resume.skills.map((skill) => skill.toLowerCase()), ...skills(resume.raw_text)]);
  const matchedSkills = [...requiredSkills].filter((skill) => [...resumeSkills].some((candidate) => fuzzyRatio(skill, candidate) >= 85));
  const missingSkills = [...requiredSkills].filter((skill) => !matchedSkills.includes(skill));

  const breakdown: ScoreBreakdown = {
    keyword_score: ratio(matchedKeywords.size, jobKeywords.size),
    skill_score: ratio(matchedSkills.length, requiredSkills.size, 70),
    experience_score: experienceScore(resume, jobKeywords),
    education_score: resume.education.length ? 100 : 35,
    project_score: projectScore(resume, jobKeywords),
    formatting_score: formattingScore(resume),
    grammar_score: grammarScore(resume.raw_text),
    achievement_score: achievementScore(resume),
  };
  const overall = (Object.keys(WEIGHTS) as Array<keyof ScoreBreakdown>).reduce((total, key) => total + breakdown[key] * WEIGHTS[key], 0);
  return {
    overall_score: round2(overall),
    breakdown,
    matched_keywords: sorted(matchedKeywords),
    missing_keywords: sorted(missingKeywords),
    matched_skills: sorted(matchedSkills),
    missing_skills: sorted(missingSkills),
    improvement_notes: improvementNotes(breakdown, sorted(missingSkills)),
  };
}

/** Top 40 non-stop-word terms; ties keep first-seen order like Python's Counter.most_common. */
function keywords(text: string): Set<string> {
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[a-zA-Z][a-zA-Z+#-]{2,}/g) ?? []) {
    if (!STOP_WORDS.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  return new Set(ranked.slice(0, 40).map(([word]) => word));
}

function skills(text: string): Set<string> {
  return new Set([...text.matchAll(SKILL_PATTERN)].map((match) => match[0].toLowerCase()));
}

/** Equivalent of rapidfuzz.fuzz.ratio: normalized Indel similarity (0-100). */
export function fuzzyRatio(left: string, right: string): number {
  const total = left.length + right.length;
  if (!total) return 100;
  let previous = new Array<number>(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i++) {
    const current = new Array<number>(right.length + 1).fill(0);
    for (let j = 1; j <= right.length; j++) {
      current[j] = left[i - 1] === right[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    previous = current;
  }
  return ((2 * previous[right.length]) / total) * 100;
}

function formattingScore(resume: Resume): number {
  let score = 30;
  score += resume.name ? 15 : 0;
  score += resume.contact.email ? 15 : 0;
  score += Math.min(25, Object.keys(resume.sections).length * 5);
  score += resume.raw_text.length >= 300 ? 15 : 0;
  return Math.min(score, 100);
}

function relevance(text: string, jobKeywords: Set<string>): number {
  const relevant = [...jobKeywords].filter((keyword) => containsWord(text, keyword)).length;
  return ratio(relevant, jobKeywords.size);
}

function experienceScore(resume: Resume, jobKeywords: Set<string>): number {
  if (!resume.experience.length) return 0;
  const text = resume.experience.map((role) => [role.title, role.company, ...role.description].join(" ")).join(" ").toLowerCase();
  const coverage = Math.min(35, resume.experience.length * 8.75);
  return round2(Math.min(100, coverage + relevance(text, jobKeywords) * 0.65));
}

function projectScore(resume: Resume, jobKeywords: Set<string>): number {
  if (!resume.projects.length) return 0;
  const text = resume.projects.map((project) => [project.name, ...project.description].join(" ")).join(" ").toLowerCase();
  const coverage = Math.min(45, resume.projects.length * 15);
  return round2(Math.min(100, 20 + coverage + relevance(text, jobKeywords) * 0.35));
}

/** Conservative writing-quality heuristic; not a replacement for grammar checking. */
function grammarScore(text: string): number {
  const sentences = text.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean);
  if (!sentences.length) return 0;
  const capitalized = sentences.filter((sentence) => sentence[0] !== sentence[0].toLowerCase()).length;
  const whitespacePenalty = Math.min(15, (text.match(/\s{3,}/g)?.length ?? 0) * 2);
  const fragmentPenalty = Math.min(20, sentences.filter((sentence) => sentence.split(/\s+/).length < 3).length * 2);
  return round2(Math.max(0, 60 + (capitalized / sentences.length) * 25 - whitespacePenalty - fragmentPenalty));
}

function achievementScore(resume: Resume): number {
  const bullets = [...resume.experience.flatMap((role) => role.description), ...resume.projects.flatMap((project) => project.description)];
  if (!bullets.length) return 0;
  const quantified = bullets.filter((bullet) => ACHIEVEMENT_PATTERN.test(bullet)).length;
  return Math.min(100, round2((quantified / bullets.length) * 100));
}

function improvementNotes(breakdown: ScoreBreakdown, missingSkills: string[]): string[] {
  const notes = missingSkills.map((skill) => `Add evidence of ${skill} where you have relevant experience.`);
  const checks: Array<[string, number]> = [
    ["keywords", breakdown.keyword_score],
    ["experience", breakdown.experience_score],
    ["projects", breakdown.project_score],
    ["quantified achievements", breakdown.achievement_score],
  ];
  for (const [name, score] of checks) if (score < 60) notes.push(`Strengthen the ${name} section with role-specific evidence.`);
  return notes;
}
