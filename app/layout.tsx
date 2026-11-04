import type { Metadata } from "next";
import localFont from "next/font/local";
import { StartupScreen } from "@/components/shared/StartupScreen";
import { STARTUP_RECOVERY_SCRIPT } from "@/lib/startup-recovery";
import "./globals.css";

const fraunces = localFont({
  src: "./fonts/Fraunces-Variable.ttf",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-fraunces",
});

export const metadata: Metadata = {
  title: "Diabetes Care Assistant for Doctors",
  description:
    "Assistive record-review tool for longitudinal diabetes management — surfaces trends and guideline citations; the clinician decides.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fraunces.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: STARTUP_RECOVERY_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-page text-ink antialiased">
        <div id="cliniq-startup-recovery" hidden suppressHydrationWarning style={{ position: "fixed", inset: 0, zIndex: 10000, background: "#fff", color: "#14202e", padding: "max(24px, 15vh) 24px", textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 600 }}>ClinIQ couldn’t finish loading</h1>
          <p style={{ margin: "16px 0" }}>Check your connection and reload the page to try again.</p>
          <a href="" style={{ display: "inline-block", padding: "10px 18px", borderRadius: 6, background: "#205fa8", color: "#fff" }}>Reload ClinIQ</a>
        </div>
        <StartupScreen>{children}</StartupScreen>
      </body>
    </html>
  );
}
