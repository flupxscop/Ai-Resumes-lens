"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function Navigation({ newReview = true }: { newReview?: boolean }) {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    setDark(localStorage.getItem("resumelens-theme") === "dark");
  }, []);
  useEffect(() => {
    if (dark === null) return;
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("resumelens-theme", dark ? "dark" : "light");
  }, [dark]);
  return <nav className="fixed inset-x-0 top-0 z-50 flex items-center justify-between border-b bg-surface/85 px-6 py-4 backdrop-blur-lg dark:bg-dkbg/85">
    <Link href="/" className="flex items-center gap-2 text-base font-semibold tracking-tight"><span className="text-blue">⌕</span>ResumeLens AI</Link>
    <div className="flex items-center gap-3"><span className="hidden text-sm text-graytext md:inline">◷ My Reviews</span><button aria-label="Toggle theme" onClick={() => setDark((current) => !current)} className="rounded-full p-2 transition hover:bg-black/5 dark:hover:bg-white/10">◐</button>{newReview && <Link href="/new-review" className="btn-primary px-4 py-2 text-xs">＋ New Review</Link>}</div>
  </nav>;
}
