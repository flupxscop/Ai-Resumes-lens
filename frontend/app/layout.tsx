import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "ResumeLens AI", description: "AI-powered ATS resume reviews" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const themeScript = "try { document.documentElement.classList.toggle('dark', localStorage.getItem('resumelens-theme') === 'dark'); } catch {}";
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head><body>{children}</body></html>;
}
