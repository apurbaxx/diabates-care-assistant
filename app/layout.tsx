import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Diabetes Care Assistant for Doctors",
  description: "Clinical decision support for longitudinal diabetes management.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-page text-ink antialiased">{children}</body>
    </html>
  );
}
