/**
 * Heuristic structured parsing of extracted resume text.
 * Ported from backend/app/parser/resume_parser.py. Binary PDF/DOCX extraction happens in
 * the browser so the Worker stays well inside the free plan's CPU budget.
 */

import type { Certification, Contact, Education, Experience, Project, Resume } from "./types";

export class ResumeParseError extends Error {}

const SECTION_ALIASES: Record<string, string[]> = {
  summary: ["summary", "professional summary", "profile", "objective"],
  skills: ["skills", "technical skills", "core competencies", "competencies", "skills, tools & languages", "skills tools & languages"],
  education: ["education", "academic background", "qualifications"],
  experience: ["experience", "work experience", "employment history", "professional experience", "technical experience"],
  projects: ["projects", "personal projects", "selected projects", "selected ai projects", "academic projects", "key projects"],
  certifications: ["certifications", "certificates", "licenses"],
  languages: ["languages", "language skills"],
};
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const PHONE_PATTERN = /(?<!\w)(?:\+?\d[\d(). -]{7,}\d)(?!\w)/g;
const URL_PATTERN = /https?:\/\/[^\s|]+|(?:www\.)[^\s|]+/gi;
const EMPLOYER_DATE_PATTERN = /^(?<company>.+?)\s*\|\s*(?<dates>.+?\d{4}.+)$/;
const ACTION_LINE_PATTERN = new RegExp(
  "^(?:architected|assessed|assisted|analyzed|applied|built|collaborated|collected|combined|" +
    "compared|confirmed|contributed|coordinated|developed|deployed|designed|diagnosed|documented|engineered|" +
    "established|executed|guided|implemented|integrated|leveraged|liaised|maintained|measured|" +
    "led|mentored|optimized|performed|prepared|provided|reviewed|simulated|supported|trained|transformed|" +
    "verified|visualized)\\b",
  "i",
);
const BULLET_PREFIXES = ["•", "-", "*"];

const startsWithBullet = (line: string) => BULLET_PREFIXES.some((prefix) => line.startsWith(prefix));
const stripChars = (value: string, chars: string) => {
  let start = 0;
  let end = value.length;
  while (start < end && chars.includes(value[start])) start++;
  while (end > start && chars.includes(value[end - 1])) end--;
  return value.slice(start, end);
};
const isUpper = (value: string) => value === value.toUpperCase() && value !== value.toLowerCase();
const titleCase = (value: string) => value.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, prefix, letter) => prefix + letter.toUpperCase());
const unique = (values: string[]) => [...new Set(values)];
const hasPhone = (line: string) => new RegExp(PHONE_PATTERN.source).test(line);

export function parseResume(text: string, filename: string | null = null): Resume {
  const raw = normalizeText(text);
  if (!raw) throw new ResumeParseError("The uploaded document does not contain extractable text");
  const sections = detectSections(raw);
  return {
    name: extractName(raw),
    contact: extractContact(raw),
    summary: sections.summary || null,
    skills: extractSkills(sections.skills ?? ""),
    education: extractEducation(sections.education ?? ""),
    experience: extractExperience(sections.experience ?? ""),
    projects: extractProjects(sections.projects ?? ""),
    certifications: extractCertifications(sections.certifications ?? ""),
    sections,
    raw_text: raw,
    source_filename: filename,
  };
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/•/g, "•")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function detectSections(text: string): Record<string, string> {
  const lines = text.split("\n");
  const headers: Array<[number, string]> = [];
  lines.forEach((line, index) => {
    const heading = stripChars(line.toLowerCase().trim(), " :.-");
    const match = Object.entries(SECTION_ALIASES).find(([, aliases]) => aliases.includes(heading));
    if (match) headers.push([index, match[0]]);
  });
  const sections: Record<string, string> = {};
  headers.forEach(([start, name], position) => {
    const end = position + 1 < headers.length ? headers[position + 1][0] : lines.length;
    const content = lines.slice(start + 1, end).join("\n").trim();
    if (content) sections[name] = content;
  });
  return sections;
}

function extractName(text: string): string | null {
  const lines = text.split("\n");
  const header = lines.slice(0, 12);
  const display = (line: string) => (isUpper(line) ? titleCase(line) : line);

  // PDF text extraction can place right-aligned dates before the visual header.
  for (let index = 0; index < header.length - 1; index++) {
    const next = header[index + 1];
    if ((EMAIL_PATTERN.test(next) || hasPhone(next)) && isNameCandidate(header[index])) return display(header[index]);
  }
  // Sidebar templates: a name directly above an all-caps professional headline.
  for (let index = 0; index < lines.length - 1; index++) {
    if (isNameCandidate(lines[index]) && looksLikeHeadline(lines[index + 1])) return display(lines[index]);
  }
  const candidate = header.find(isNameCandidate);
  return candidate ? display(candidate) : null;
}

function isNameCandidate(line: string): boolean {
  if (EMAIL_PATTERN.test(line) || hasPhone(line) || line.length > 80) return false;
  if (/\d/.test(line)) return false;
  const words = line.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 5 && words.every((word) => /^\p{L}+$/u.test(word.replace(/-/g, "")));
}

function looksLikeHeadline(line: string): boolean {
  const normalized = line.replace(/-/g, " ").toUpperCase();
  return isUpper(line) && line.length <= 80 && ["DEVELOPER", "ENGINEER", "DESIGNER", "ANALYST", "MANAGER", "CONSULTANT"].some((word) => normalized.includes(word));
}

function extractContact(text: string): Contact {
  const header = text.split("\n").slice(0, 8).join("\n");
  const urls = [...(header.match(URL_PATTERN) ?? [])];
  for (const match of header.matchAll(/(?:github|gitlab|kaggle|hugging\s*face|portfolio|website)\s*:\s*([^\s|]+)/gi)) urls.push(match[1]);
  const normalized = urls.map((url) => (url.startsWith("http") ? url : `https://${url}`));
  const linkedin = normalized.find((url) => url.toLowerCase().includes("linkedin.com")) ?? null;
  const portfolio = normalized.find((url) => url !== linkedin) ?? null;
  const phone = [...header.matchAll(PHONE_PATTERN)].map((match) => match[0]).find((value) => !/\d{4}\s*(?:-|–|—)\s*\d{4}/.test(value)) ?? null;
  return { email: header.match(EMAIL_PATTERN)?.[0] ?? null, phone, location: null, linkedin_url: linkedin, portfolio_url: portfolio };
}

/** Reconstruct bullet points whose text wrapped across PDF lines. */
function bulletItems(lines: string[]): string[] {
  const items: string[] = [];
  for (const line of lines) {
    const cleaned = line.trim();
    if (!cleaned || /^\d{4}\s*(?:-|–|—)\s*(?:\d{4}|present)$/i.test(cleaned)) continue;
    if (startsWithBullet(cleaned)) {
      const item = stripChars(cleaned, "•-* ").trim();
      if (item) items.push(item);
    } else if (ACTION_LINE_PATTERN.test(cleaned)) items.push(cleaned);
    else if (items.length) items[items.length - 1] = `${items[items.length - 1]} ${cleaned}`;
    else items.push(cleaned);
  }
  return items;
}

function extractSkills(section: string): string[] {
  const skills: string[] = [];
  for (const line of section.split("\n")) {
    const categoryFree = line.trim().replace(/^[A-Za-z/& ]{2,24}:\s*/, "");
    for (const candidate of categoryFree.split(/[,;•](?![^()]*\))/)) {
      const skill = stripChars(candidate, " -");
      if (skill.startsWith("(") && skills.length) skills[skills.length - 1] = `${skills[skills.length - 1]} ${skill}`;
      else if (skill.length > 1 && skill.length <= 80) skills.push(skill);
    }
  }
  return unique(skills);
}

function splitDates(value: string): [string | null, string | null] {
  const trimmed = value.trim();
  const match = trimmed.match(/\s*(?:–|—|-)\s*/);
  if (!match || match.index === undefined) return [trimmed, null];
  return [trimmed.slice(0, match.index), trimmed.slice(match.index + match[0].length)];
}

const education = (institution: string, degree: string | null = null, start: string | null = null, end: string | null = null): Education => ({
  institution, degree, field_of_study: null, start_date: start, end_date: end, grade: null,
});
const experience = (company: string, title: string, description: string[], start: string | null = null, end: string | null = null): Experience => ({
  company, title, start_date: start, end_date: end, location: null, description, skills: [],
});

function nonEmptyLines(section: string): string[] {
  return section.split("\n").map((line) => line.trim()).filter(Boolean);
}

function extractEducation(section: string): Education[] {
  const lines = nonEmptyLines(section);
  const results: Education[] = [];
  lines.forEach((line, index) => {
    const match = line.match(EMPLOYER_DATE_PATTERN);
    if (!match?.groups) return;
    const [start, end] = splitDates(match.groups.dates);
    results.push(education(match.groups.company.trim(), index ? lines[index - 1] : null, start, end));
  });
  if (results.length) return results;
  const index = lines.findIndex((line) => /\b(?:university|college|institute|school)\b/i.test(line));
  if (index >= 0) return [education(lines[index], index ? lines[index - 1] : null)];
  return lines.slice(0, 1).map((line) => education(line));
}

function looksLikeCompany(line: string): boolean {
  const normalized = line.toLowerCase();
  return line.length >= 4 && ["co.", "ltd", "inc", "llc", "corp", "company", "innovations", "technologies", "solutions"].some((token) => normalized.includes(token));
}

function looksLikeJobTitle(line: string): boolean {
  const normalized = line.replace(/-/g, " ").toLowerCase();
  return (
    !startsWithBullet(line) &&
    line.split(/\s+/).filter(Boolean).length <= 8 &&
    ["developer", "engineer", "designer", "analyst", "manager", "consultant", "specialist", "intern"].some((word) => normalized.includes(word))
  );
}

function extractExperience(section: string): Experience[] {
  const lines = nonEmptyLines(section);
  const markers = lines
    .map((line, index) => [index, line.match(EMPLOYER_DATE_PATTERN)] as const)
    .filter((entry): entry is readonly [number, RegExpMatchArray] => Boolean(entry[1]?.groups));
  const results: Experience[] = markers.map(([lineIndex, match], markerIndex) => {
    const hasNext = markerIndex + 1 < markers.length;
    const nextMarker = hasNext ? markers[markerIndex + 1][0] : lines.length;
    const descriptionEnd = hasNext ? nextMarker - 1 : nextMarker;
    const [start, end] = splitDates(match.groups!.dates);
    return experience(match.groups!.company.trim(), lineIndex ? lines[lineIndex - 1] : "Not specified", bulletItems(lines.slice(lineIndex + 1, descriptionEnd)), start, end);
  });
  if (results.length) return results;

  // Modern templates list "job title" then "company" with dates in a separate column.
  const pairs: Array<[number, number]> = [];
  for (let index = 0; index < lines.length - 1; index++) {
    if (looksLikeJobTitle(lines[index]) && looksLikeCompany(lines[index + 1])) pairs.push([index, index + 1]);
  }
  pairs.forEach(([titleIndex, companyIndex], position) => {
    const next = position + 1 < pairs.length ? pairs[position + 1][0] : lines.length;
    results.push(experience(lines[companyIndex], lines[titleIndex], bulletItems(lines.slice(companyIndex + 1, next))));
  });
  if (results.length) return results;

  // Two-column PDFs may extract dates separately from company and role.
  const companyIndexes = lines
    .slice(0, -1)
    .map((line, index) => [line, index] as const)
    .filter(([line, index]) => looksLikeCompany(line) && !startsWithBullet(lines[index + 1]))
    .map(([, index]) => index);
  companyIndexes.forEach((lineIndex, position) => {
    const next = position + 1 < companyIndexes.length ? companyIndexes[position + 1] : lines.length;
    results.push(experience(lines[lineIndex], lines[lineIndex + 1], bulletItems(lines.slice(lineIndex + 2, next))));
  });
  return results;
}

const isProjectTitle = (line: string) => /^[A-Z][A-Za-z0-9/&() -]{2,}$/.test(line) && !line.endsWith(".");
const project = (name: string, lines: string[]): Project => ({ name, description: bulletItems(lines), technologies: [], url: null });

function extractProjects(section: string): Project[] {
  const projects: Project[] = [];
  let currentName: string | null = null;
  let currentLines: string[] = [];
  for (const line of section.split("\n")) {
    const cleaned = line.trim();
    if (!cleaned) continue;
    if (startsWithBullet(cleaned) || ACTION_LINE_PATTERN.test(cleaned)) currentLines.push(cleaned);
    else if (cleaned.startsWith("(") && currentName !== null) currentLines.push(cleaned);
    else if (currentName !== null && currentLines.length && !isProjectTitle(cleaned)) currentLines.push(cleaned);
    else {
      if (currentName !== null) projects.push(project(currentName, currentLines));
      currentName = cleaned;
      currentLines = [];
    }
  }
  if (currentName !== null) projects.push(project(currentName, currentLines));
  return projects;
}

function extractCertifications(section: string): Certification[] {
  return section
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => ({ name: stripChars(line, "•-* "), issuer: null, issued_date: null, credential_id: null }));
}
