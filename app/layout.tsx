import type { Metadata } from "next";
import localFont from "next/font/local";
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
      <body className="min-h-screen bg-page text-ink antialiased">{children}</body>
    </html>
  );
}
