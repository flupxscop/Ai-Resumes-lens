"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Navigation } from "../../components/navigation";
import type { ReviewResult } from "../../lib/api";

const fallback: ReviewResult = {
  resume: { name: "Jordan Davis", skills: ["Figma", "Design Systems", "User Research", "Prototyping"], experience: [], education: [], projects: [] },
  ats_result: { overall_score: 87, breakdown: { keyword_score: 92, skill_score: 90, experience_score: 84, education_score: 80, project_score: 86, formatting_score: 94, grammar_score: 89, achievement_score: 78 }, matched_skills: ["Figma", "Design Systems", "Prototyping"], missing_skills: ["Research Strategy", "Analytics"] },
  feedback: {
    overall_summary: "Your resume demonstrates strong alignment with the target role. Your design system experience and measurable product impact are clear. Strengthen user research methodology and add more quantified outcomes to create an even stronger application.",
    strengths: ["Strong Figma and design system expertise", "Clear product-delivery experience", "Relevant portfolio-oriented project work"],
    weaknesses: ["Research methodology is not consistently described", "Several experience bullets lack quantified impact"],
    recommendations: ["Add research methodology to key project bullets", "Quantify business impact in each role", "Describe cross-functional decisions more explicitly"],
    keyword_suggestions: ["user research", "design strategy", "product analytics", "accessibility"],
    resume_rewrite_suggestions: ["Start each bullet with a design decision and its outcome", "Use measurable results where possible"],
    missing_skills: ["Research Strategy", "Analytics"],
    interview_preparation: ["Prepare a STAR story about design systems", "Explain a research decision that changed a product direction"],
  },
  provider_response: { provider: "Ollama", model: "llama3.2" },
};

const label = (name: string) => name.replace(/_score$/, "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function ResultsPage() {
  const [result, setResult] = useState<ReviewResult>(fallback);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem("resumelens-result");
    if (stored) setResult(JSON.parse(stored));
  }, []);

  const score = Math.round(result.ats_result.overall_score);
  const initial = result.resume.name?.split(" ").map((part) => part[0]).join("").slice(0, 2) || "RL";
  const breakdown = useMemo(() => Object.entries(result.ats_result.breakdown), [result]);
  const copy = async () => { await navigator.clipboard.writeText(result.feedback.recommendations.join("\n")); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  return <><Navigation /><main className="pb-20 pt-20">
    <header className="border-b bg-white px-6 py-5 dark:bg-dksurf"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 md:flex-row md:items-center"><div className="flex items-center gap-4"><div className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-[#3A5CCC] to-[#5B7FFF] font-bold text-white">{initial}</div><div><h1 className="font-bold">{result.resume.name || "Resume review"}</h1><div className="mt-1 flex flex-wrap gap-2 text-sm text-graytext"><span>AI Resume Review</span><span>·</span><span className="chip py-0.5">{result.provider_response.provider} · {result.provider_response.model}</span><span>· Just now</span></div></div></div><div className="flex gap-2"><button onClick={copy} className="rounded-full border bg-white px-4 py-2 text-sm transition hover:bg-surface dark:bg-dksurf dark:hover:bg-dkcard">{copied ? "Copied" : "Copy recommendations"}</button>
    {/* <Link className="btn-primary px-4 py-2 text-sm" href="/new-review">＋ New Review</Link> */}
    </div></div></header>
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 md:px-6">
      <section className="grid gap-6 rounded-3xl border bg-white p-6 dark:bg-dksurf md:grid-cols-[260px_1fr]"><div className="grid place-items-center"><div className="grid h-48 w-48 place-items-center rounded-full bg-[conic-gradient(#3A5CCC_calc(var(--score)*3.6deg),#E5E5EA_0)] p-3" style={{ "--score": score } as React.CSSProperties}><div className="grid h-full w-full place-items-center rounded-full bg-white text-center dark:bg-dksurf"><strong className="text-5xl">{score}</strong><span className="text-xs text-graytext">out of 100</span></div></div><p className="mt-3 text-sm font-semibold">ATS Match Score</p></div><div className="flex flex-col justify-center"><span className="mb-2 text-xs font-semibold tracking-[.16em] text-blue">OVERALL ANALYSIS</span><h2 className="text-2xl font-bold">Ready for a stronger application</h2><p className="mt-3 max-w-3xl leading-relaxed text-graytext">{result.feedback.overall_summary}</p></div></section>
      <section className="grid gap-6 lg:grid-cols-[1fr_330px]"><div className="card"><h3 className="mb-6 font-semibold">ATS Score Breakdown</h3><div className="space-y-5">{breakdown.map(([key, value]) => <div key={key}><div className="mb-2 flex justify-between text-sm"><span>{label(key)}</span><strong>{Math.round(value)}</strong></div><div className="h-2 overflow-hidden rounded-full bg-surface dark:bg-dkcard"><div className="h-full rounded-full bg-gradient-to-r from-[#3A5CCC] to-[#5B7FFF]" style={{ width: `${value}%` }} /></div></div>)}</div></div><div className="card"><h3 className="mb-5 font-semibold">Skills Analysis</h3><p className="mb-3 text-xs text-graytext">MATCHED SKILLS</p><div className="flex flex-wrap gap-2">{result.ats_result.matched_skills.map((skill) => <span className="rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-400" key={skill}>{skill}</span>)}</div><p className="mb-3 mt-6 text-xs text-graytext">SKILLS TO STRENGTHEN</p><div className="flex flex-wrap gap-2">{result.ats_result.missing_skills.map((skill) => <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400" key={skill}>{skill}</span>)}</div></div></section>
      <section className="grid gap-6 md:grid-cols-2"><FeedbackCard title="Strengths" items={result.feedback.strengths} accent="text-green-600" /><FeedbackCard title="Weaknesses" items={result.feedback.weaknesses} accent="text-red-600" /><FeedbackCard title="Priority Improvements" items={result.feedback.recommendations} accent="text-blue" /><FeedbackCard title="Keyword Suggestions" items={result.feedback.keyword_suggestions} accent="text-blue" /><FeedbackCard title="Resume Rewrite Suggestions" items={result.feedback.resume_rewrite_suggestions} accent="text-blue" /></section>
      <section className="card"><h3 className="mb-4 font-semibold">Interview Preparation</h3>{result.feedback.interview_preparation.length ? <div className="grid gap-3 md:grid-cols-2">{result.feedback.interview_preparation.map((item) => <p key={item} className="rounded-2xl bg-surface p-4 text-sm text-graytext dark:bg-dkcard">{item}</p>)}</div> : <p className="text-sm text-graytext">No interview preparation suggestions were returned for this review.</p>}</section>
      <section className="overflow-hidden rounded-3xl border bg-white dark:bg-dksurf"><button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between p-6 text-left"><span><strong className="block">Parsed Resume</strong><span className="text-sm text-graytext">Structured information extracted from your upload</span></span><span className="text-xl">{open ? "⌃" : "⌄"}</span></button>{open && <div className="grid gap-6 border-t p-6 md:grid-cols-2"><div><p className="mb-3 text-sm font-semibold">Skills</p><div className="flex flex-wrap gap-2">{result.resume.skills.map((skill) => <span className="chip" key={skill}>{skill}</span>)}</div></div><div><p className="mb-3 text-sm font-semibold">Resume sections</p><p className="text-sm text-graytext">{result.resume.experience.length} experience roles · {result.resume.education.length} education records · {result.resume.projects.length} projects</p></div></div>}</section>
    </div>
  </main></>;
}

function FeedbackCard({ title, items, accent }: { title: string; items: string[]; accent: string }) {
  return <section className="card"><h3 className="mb-4 font-semibold">{title}</h3>{items.length ? <ul className="space-y-3">{items.map((item) => <li className="flex gap-3 text-sm leading-relaxed text-graytext" key={item}><span className={accent}>●</span>{item}</li>)}</ul> : <p className="text-sm text-graytext">No additional suggestions for this review.</p>}</section>;
}
