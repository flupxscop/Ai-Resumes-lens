import { afterEach, describe, expect, it, vi } from "vitest";
import { scoreResume, fuzzyRatio } from "../src/ats";
import { FeedbackParseError, parseFeedback, removePresentSkills } from "../src/feedback";
import { parseResume } from "../src/parser";
import { providerChain, type Env } from "../src/providers";
import worker from "../src/index";

const FEEDBACK = {
  overall_summary: "Summary",
  strengths: ["Python", "Computer Vision"],
  weaknesses: ["Limited metrics", "Cloud evidence"],
  recommendations: ["Add metrics", "Tailor keywords"],
  keyword_suggestions: ["MLOps", "model deployment"],
  resume_rewrite_suggestions: ["Lead with impact", "Use action verbs"],
  missing_skills: ["Computer Vision", "MLOps"],
  interview_preparation: ["Explain CV deployment", "Prepare a model tradeoff"],
};

describe("resume parser", () => {
  it("keeps projects out of skills and pairs experience records", () => {
    const resume = parseResume(`Nuntawat Chantaro
Work Experience
AI Intern
FPT Software Vietnam | Nov 2025 – Feb 2026
• Executed 600+ voice-command test cases.
Education
Bachelor of Science in Computer Science
Mahasarakham University | 2022 - 2026
Technical Skills
Programming: Python, SQL
Selected AI Projects
AI Resume Reviewer
• Built an ATS feedback pipeline.`);
    expect(resume.experience[0]).toMatchObject({ title: "AI Intern", company: "FPT Software Vietnam", description: ["Executed 600+ voice-command test cases."] });
    expect(resume.education[0]).toMatchObject({ degree: "Bachelor of Science in Computer Science", institution: "Mahasarakham University" });
    expect(resume.projects[0].name).toBe("AI Resume Reviewer");
    expect(resume.skills).toEqual(["Python", "SQL"]);
  });

  it("recovers header name and sections from two-column PDF text", () => {
    const resume = parseResume(`Bangkok, Thailand
2023 - Present
SOMCHAI DEVSTARS
Bangkok, Thailand | +66 81 234 5678 | somchai.dev@email.com
EDUCATION
CHULALONGKORN UNIVERSITY
TECHNICAL EXPERIENCE
TECHSOLUTION CO., LTD.
Senior Full-Stack Developer
• Built FastAPI services.
DIGITAL NEXUS INNOVATIONS
Full-Stack Developer
• Built React applications.
KEY PROJECTS
Enterprise Resource Management System
• Architected a dashboard.
SKILLS, TOOLS & LANGUAGES
Backend Technologies: Python, FastAPI, PostgreSQL`);
    expect(resume.name).toBe("Somchai Devstars");
    expect(resume.contact.email).toBe("somchai.dev@email.com");
    expect(resume.experience).toHaveLength(2);
    expect(resume.projects[0].name).toBe("Enterprise Resource Management System");
    expect(resume.skills).toContain("Python");
  });

  it("recovers sidebar template name and title/company experience", () => {
    const resume = parseResume(`2023 - Present
CONTACT
somchai.dev@email.com
TECHNICAL SKILLS
Python, FastAPI, AWS (S3, EC2)
LANGUAGES
THAI
Somchai Devstars
SENIOR FULL-STACK DEVELOPER
PROFESSIONAL SUMMARY
Experienced developer.
WORK EXPERIENCE
Senior Full-Stack Developer
TechSolution Co., Ltd.
• Built FastAPI services.
Full-Stack Developer
Digital Nexus Innovations
• Built React applications.
EDUCATION
Bachelor of Science in Computer Science
Chulalongkorn University`);
    expect(resume.name).toBe("Somchai Devstars");
    expect(resume.experience.map((role) => role.company)).toEqual(["TechSolution Co., Ltd.", "Digital Nexus Innovations"]);
    expect(resume.experience[0].title).toBe("Senior Full-Stack Developer");
    expect(resume.education[0]).toMatchObject({ institution: "Chulalongkorn University", degree: "Bachelor of Science in Computer Science" });
    expect(resume.skills).toContain("AWS (S3, EC2)");
  });
});

describe("ATS scoring", () => {
  it("identifies matching and missing skills", () => {
    const resume = { ...parseResume("Jane Doe\njane@example.com\nPython FastAPI Docker\nImproved API speed by 30%."), skills: ["Python", "FastAPI", "Docker"] };
    const result = scoreResume(resume, "Seeking a Python engineer with FastAPI, Docker, Kubernetes, and AWS experience.");
    expect(result.overall_score).toBeGreaterThan(0);
    expect(result.matched_skills).toContain("python");
    expect(result.missing_skills).toContain("kubernetes");
  });

  it("matches rapidfuzz ratio", () => {
    expect(fuzzyRatio("postgres", "postgresql")).toBeCloseTo(88.89, 1);
    expect(fuzzyRatio("python", "python")).toBe(100);
  });
});

describe("feedback parser", () => {
  it("normalizes fenced JSON with aliases", () => {
    const { overall_summary, ...rest } = FEEDBACK;
    const feedback = parseFeedback("```json\n" + JSON.stringify({ summary: "Strong backend profile", ...rest }) + "\n```");
    expect(feedback.overall_summary).toBe("Strong backend profile");
    expect(feedback.strengths).toEqual(["Python", "Computer Vision"]);
  });

  it("has a text fallback", () => {
    const feedback = parseFeedback(
      "Useful general advice\n\nStrengths:\n- Clear writing\n- Relevant experience\n\nWeaknesses:\n- Limited metrics\n- Missing cloud evidence\n\n" +
        "Recommendations:\n- Add metrics\n- Tailor keywords\n\nKeyword Suggestions:\n- Cloud deployment\n- AWS\n\nResume Rewrite Suggestions:\n" +
        "- Lead with impact\n- Use concise action verbs\n\nInterview Preparation:\n- Prepare an API tradeoff story\n- Explain a delivery challenge",
    );
    expect(feedback.overall_summary).toBe("Useful general advice");
    expect(feedback.strengths).toEqual(["Clear writing", "Relevant experience"]);
  });

  it("rejects unrelated JSON", () => {
    expect(() => parseFeedback('{"name":"Candidate", "experience":[]}')).toThrow(FeedbackParseError);
  });

  it("removes documented skills from missing skills", () => {
    const resume = { ...parseResume("Computer Vision projects"), skills: ["Computer Vision"] };
    expect(removePresentSkills(parseFeedback(JSON.stringify(FEEDBACK)), resume).missing_skills).toEqual(["MLOps"]);
  });
});

describe("worker", () => {
  afterEach(() => vi.unstubAllGlobals());
  const assets = { fetch: async () => new Response("asset") } as unknown as Fetcher;

  it("orders the auto chain by configured providers", () => {
    expect(providerChain({ ASSETS: assets, GROQ_API_KEY: "k", AI: {} as Ai } as Env)).toEqual(["groq", "workers-ai"]);
    expect(() => providerChain({ ASSETS: assets } as Env, "gemini")).toThrow(/not configured/);
  });

  it("falls back to the next provider when the free quota is exhausted", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      if (url.includes("googleapis")) return new Response("quota", { status: 429 });
      return Response.json({ choices: [{ message: { content: JSON.stringify(FEEDBACK) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    });
    const env = { ASSETS: assets, GEMINI_API_KEY: "g", GROQ_API_KEY: "q" } as Env;
    const request = new Request("https://example.com/api/v1/reviews", {
      method: "POST",
      body: JSON.stringify({ resume_text: "Jane Doe\njane@example.com\nSkills\nPython, FastAPI", job_description: "Python engineer with FastAPI and AWS experience." }),
    });
    const response = await worker.fetch(request, env);
    const body: any = await response.json();
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(body.provider_response).toMatchObject({ provider: "groq", model: "llama-3.3-70b-versatile" });
    expect(body.ats_result.matched_skills).toContain("python");
    expect(body.feedback.missing_skills).toEqual(["Computer Vision", "MLOps"]);
  });

  it("validates input and serves assets for non-API paths", async () => {
    const bad = await worker.fetch(new Request("https://example.com/api/v1/reviews", { method: "POST", body: JSON.stringify({ resume_text: "x", job_description: "short" }) }), { ASSETS: assets, AI: {} as Ai } as Env);
    expect(bad.status).toBe(422);
    const page = await worker.fetch(new Request("https://example.com/"), { ASSETS: assets } as Env);
    expect(await page.text()).toBe("asset");
  });
});
