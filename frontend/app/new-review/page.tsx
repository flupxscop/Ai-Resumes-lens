"use client";

import { ChangeEvent, DragEvent, FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Navigation } from "../../components/navigation";
import { createReview } from "../../lib/api";

const steps = ["Parsing resume", "Matching skills", "Calculating ATS score", "Generating feedback"];

export default function NewReviewPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [jobDescription, setJobDescription] = useState("");
  const [provider, setProvider] = useState("ollama");
  const [promptType, setPromptType] = useState("resume_review");
  const [model, setModel] = useState("");
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [error, setError] = useState("");

  const pick = (files: FileList | null) => { const selected = files?.[0]; if (selected) { setFile(selected); setError(""); } };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return setError("Please select a PDF or DOCX resume.");
    if (jobDescription.trim().length < 20) return setError("Add a job description with at least 20 characters.");
    setLoading(true); setActiveStep(0); setError("");
    const progressTimer = window.setInterval(() => setActiveStep((current) => Math.min(current + 1, steps.length - 1)), 900);
    try {
      const result = await createReview({ file, jobDescription, provider, promptType, model, additionalContext: context });
      setActiveStep(steps.length - 1);
      sessionStorage.setItem("resumelens-result", JSON.stringify(result));
      router.push("/results");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Analysis failed.");
      setLoading(false);
    } finally { window.clearInterval(progressTimer); }
  };

  return <><Navigation newReview={false} /><main className="mx-auto max-w-7xl px-4 pb-16 pt-28 md:px-6"><div className="mb-10"><p className="mb-3 text-xs text-graytext">Home <span className="px-2">›</span> <span className="font-medium text-ink dark:text-white">New Review</span></p><h1 className="text-3xl font-bold tracking-tight md:text-4xl">Create a new review</h1><p className="mt-2 text-graytext">Upload your resume and job description to get your AI-powered analysis.</p></div><form onSubmit={submit} className="grid items-start gap-8 lg:grid-cols-[1fr_340px]"><div className="space-y-6"><section className="card"><h2 className="font-semibold">Resume</h2><p className="mt-1 text-sm text-graytext">PDF or DOCX, maximum 10 MB</p><label onDragOver={(event: DragEvent) => event.preventDefault()} onDrop={(event: DragEvent) => { event.preventDefault(); pick(event.dataTransfer.files); }} className="mt-5 flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#D1D1D6] px-6 text-center transition hover:border-blue hover:bg-blue/5 dark:border-dkline"><input className="hidden" type="file" accept=".pdf,.docx" onChange={(event: ChangeEvent<HTMLInputElement>) => pick(event.target.files)} />{file ? <><strong>{file.name}</strong><span className="mt-1 text-sm text-graytext">{(file.size / 1024 / 1024).toFixed(2)} MB · Click to replace</span><button onClick={(event) => { event.preventDefault(); setFile(null); }} className="mt-3 text-sm text-red-500">Remove file</button></> : <><span className="mb-3 text-2xl text-blue">↑</span><strong>Drop your resume here</strong><span className="mt-1 text-sm text-graytext">or click to browse files</span></>}</label></section><section className="card"><h2 className="font-semibold">Job Description</h2><textarea value={jobDescription} onChange={(event) => setJobDescription(event.target.value)} className="field mt-4 min-h-56 resize-y" placeholder="Paste the role, responsibilities, and required skills here." /></section><section className="card"><h2 className="mb-4 font-semibold">Analysis Settings</h2><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-medium text-graytext">AI Provider<select value={provider} onChange={(event) => setProvider(event.target.value)} className="field mt-1.5 text-ink dark:text-white"><option value="ollama">Ollama (local)</option><option value="openai">OpenAI</option><option value="gemini">Gemini</option></select></label><label className="text-xs font-medium text-graytext">Review Type<select value={promptType} onChange={(event) => setPromptType(event.target.value)} className="field mt-1.5 text-ink dark:text-white"><option value="resume_review">Resume Review</option><option value="cover_letter">Cover Letter</option><option value="interview_prep">Interview Preparation</option><option value="career_advice">Career Advice</option></select></label></div><label className="mt-4 block text-xs font-medium text-graytext">Model (optional)<input value={model} onChange={(event) => setModel(event.target.value)} className="field mt-1.5 text-ink dark:text-white" placeholder="llama3.2" /></label><label className="mt-4 block text-xs font-medium text-graytext">Additional context (optional)<textarea value={context} onChange={(event) => setContext(event.target.value)} className="field mt-1.5 min-h-24 text-ink dark:text-white" placeholder="Career target or specific questions" /></label></section>{error && <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/30">{error}</p>}<button disabled={loading} className="btn-primary px-8 py-3">{loading ? "Analyzing your resume…" : "Analyze resume →"}</button></div><aside className="card sticky top-24"><h3 className="font-semibold">What you&apos;ll receive</h3><div className="mt-5 space-y-5">{[["◉", "ATS Score", "A transparent breakdown of role alignment."], ["⌘", "Skill Gap Analysis", "Skills you have and skills to strengthen."], ["✦", "Actionable Feedback", "Recommendations, rewrites, and interview ideas."]].map(([icon, title, text]) => <div key={title} className="flex gap-3"><span className="text-lg text-blue">{icon}</span><div><p className="text-sm font-medium">{title}</p><p className="mt-1 text-sm leading-relaxed text-graytext">{text}</p></div></div>)}</div></aside></form></main>{loading && <ProgressOverlay activeStep={activeStep} />}</>;
}

function ProgressOverlay({ activeStep }: { activeStep: number }) {
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-surface/85 px-5 backdrop-blur-md dark:bg-dkbg/85" role="status" aria-live="polite"><div className="card w-full max-w-md text-center"><div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-4 border-blue/20 border-t-blue" /><h2 className="text-2xl font-bold">Analyzing your resume…</h2><p className="mt-2 text-sm text-graytext">This may take a moment.</p><div className="mt-8 space-y-4 text-left">{steps.map((step, index) => { const completed = index < activeStep; const active = index === activeStep; return <div key={step} className={`flex items-center gap-3 text-sm transition-colors duration-300 ${active ? "font-semibold text-ink dark:text-white" : completed ? "text-blue" : "text-graytext"}`}><span className={`grid h-6 w-6 place-items-center rounded-full text-xs transition-all duration-300 ${active ? "scale-110 bg-blue text-white shadow-[0_0_0_5px_rgba(58,92,204,.12)]" : completed ? "bg-blue/15 text-blue" : "bg-surface text-graytext dark:bg-dkcard"}`}>{completed ? "✓" : index + 1}</span>{step}</div>; })}</div></div></div>;
}
