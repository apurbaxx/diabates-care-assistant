import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MiB limit
const ML_SERVICE_URL = process.env.LAB_EXTRACT_SERVICE_URL || process.env.ML_SERVICE_URL || "http://127.0.0.1:8000";
const ML_SERVICE_API_KEY = process.env.ML_SERVICE_API_KEY || "cliniq-knowledge-internal-key";

let activeWorker = false;

/**
 * Extracts structured laboratory test findings from an uploaded PDF.
 * 
 * Attempts FastAPI ML service first; falls back to ephemeral Python subprocess
 * when the ML service is offline (e.g. Supabase mode on memory-constrained dynos).
 */
export async function POST(req: NextRequest) {
  if (activeWorker) {
    return NextResponse.json(
      { error: "Another PDF report extraction is currently in progress. Please retry in a few seconds." },
      { status: 429 }
    );
  }

  activeWorker = true;
  try {
    const contentType = req.headers.get("content-type") || "";
    let pdfBuffer: Buffer;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "No PDF file provided in the upload." }, { status: 400 });
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: "PDF report size exceeds the 10 MB limit." }, { status: 413 });
      }
      const arrayBuffer = await file.arrayBuffer();
      pdfBuffer = Buffer.from(arrayBuffer);
    } else if (contentType.startsWith("application/pdf") || contentType.includes("octet-stream")) {
      const contentLength = Number(req.headers.get("content-length") || 0);
      if (contentLength > MAX_BYTES) {
        return NextResponse.json({ error: "PDF report size exceeds the 10 MB limit." }, { status: 413 });
      }
      const chunks: Uint8Array[] = [];
      let totalLength = 0;
      const reader = req.body?.getReader();
      if (!reader) {
        return NextResponse.json({ error: "The uploaded PDF is empty." }, { status: 400 });
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalLength += value.byteLength;
        if (totalLength > MAX_BYTES) {
          await reader.cancel();
          return NextResponse.json({ error: "PDF report size exceeds the 10 MB limit." }, { status: 413 });
        }
        chunks.push(value);
      }
      pdfBuffer = Buffer.concat(chunks);
    } else {
      return NextResponse.json(
        { error: "Upload a PDF report (Content-Type: application/pdf or multipart/form-data)." },
        { status: 415 }
      );
    }

    if (!pdfBuffer.length || !pdfBuffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      return NextResponse.json(
        { error: "Choose a valid selectable-text PDF laboratory report." },
        { status: 400 }
      );
    }

    // 1. Try FastAPI ML Service first (if running)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const mlRes = await fetch(`${ML_SERVICE_URL}/extract-pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/pdf",
          "X-API-Key": ML_SERVICE_API_KEY,
        },
        body: new Uint8Array(pdfBuffer),
        signal: controller.signal,
        cache: "no-store",
      });

      clearTimeout(timeoutId);

      if (mlRes.ok) {
        const data = await mlRes.json();
        return NextResponse.json(data, {
          status: 200,
          headers: { "Cache-Control": "no-store" },
        });
      } else if (mlRes.status === 422) {
        // Extraction error from FastAPI (e.g. scanned PDF or password protected)
        const errJson = await mlRes.json().catch(() => ({ detail: "Extraction error" }));
        return NextResponse.json(
          { error: errJson.detail || "Unable to parse this PDF layout." },
          { status: 422, headers: { "Cache-Control": "no-store" } }
        );
      }
    } catch {
      // ML Service unreachable or timed out -> Fall back to local ephemeral Python process
    }

    // 2. Ephemeral Subprocess Fallback (PyMuPDF + RapidFuzz)
    const pythonScript = path.join(process.cwd(), "ml-service", "app", "lab_pdf.py");
    const pythonExe = process.env.LAB_PYTHON || "python";

    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const child = spawn(pythonExe, [pythonScript], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdoutData = "";
      const timeoutTimer = setTimeout(() => {
        child.kill();
        reject(new Error("PDF extraction timed out after 15 seconds. Try a shorter or simpler report."));
      }, 15000);

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutData += chunk.toString("utf-8");
        if (stdoutData.length > 5_000_000) {
          child.kill();
          reject(new Error("PDF output exceeds safe size limit."));
        }
      });

      child.stderr.resume(); // Drain stderr
      child.stdin.on("error", () => {});
      child.on("error", () => {
        clearTimeout(timeoutTimer);
        reject(new Error("PDF extraction is unavailable. Ensure Python and PyMuPDF are installed."));
      });

      child.on("close", (code) => {
        clearTimeout(timeoutTimer);
        try {
          const parsed = JSON.parse(stdoutData);
          resolve(parsed);
        } catch {
          reject(new Error("Failed to parse extraction output. Ensure PyMuPDF and RapidFuzz are installed."));
        }
      });

      child.stdin.end(pdfBuffer);
    });

    const statusCode = result.error ? 422 : 200;
    return NextResponse.json(result, {
      status: statusCode,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PDF extraction failed." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  } finally {
    activeWorker = false;
  }
}
