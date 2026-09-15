import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Diabetes Care Assistant for Doctors",
  description:
    "Assistive record-review tool for longitudinal diabetes management — surfaces trends and guideline citations; the clinician decides.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-page text-ink antialiased">{children}</body>
    </html>
  );
}
