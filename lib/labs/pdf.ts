export const MAX_REPORT_BYTES = 10 * 1024 * 1024;
export async function extractFile(file: File): Promise<string> {
  if (!file.size || file.size > MAX_REPORT_BYTES) throw new Error("Upload a nonempty PDF, TXT or CSV file up to 10 MB");
  const extension = file.name.toLowerCase().split(".").pop();
  if (!extension || !["pdf", "txt", "csv"].includes(extension)) throw new Error("Supported formats: PDF, TXT and CSV");
  if (extension !== "pdf") {
    const text = await file.text();
    if (text.includes("\u0000")) throw new Error("This file is not a text laboratory report");
    if (text.length > 500_000) throw new Error("Report text exceeds 500,000 characters");
    return text;
  }
  const data = new Uint8Array(await file.arrayBuffer());
  if (!new TextDecoder().decode(data.slice(0,5)).startsWith("%PDF-")) throw new Error("Invalid PDF file signature");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const document = await Promise.race([task.promise, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => { void task.destroy(); reject(new Error("PDF extraction timed out")); }, 30_000);
    })]);
    if (document.numPages > 50) throw new Error("Reports are limited to 50 pages");
    const lines: string[] = [];
    let length = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let line = "";
      let lastY: number | undefined;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = item.transform[5];
        if (lastY !== undefined && Math.abs(y - lastY) > 3 && line.trim()) { lines.push(line); line = ""; }
        line += item.str + " "; lastY = y; length += item.str.length;
        if (item.hasEOL) { lines.push(line); line = ""; lastY = undefined; }
        if (length > 500_000) throw new Error("Extracted report exceeds 500,000 characters");
      }
      if (line.trim()) lines.push(line);
    }
    const text = lines.join("\n").trim();
    if (!text) throw new Error("This PDF has no extractable text. Scanned reports need OCR, which is not supported. Paste a transcription for review instead.");
    return text;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "PDF extraction failed. The file may be encrypted or damaged.");
  } finally { if (timeout) clearTimeout(timeout); await task.destroy(); }
}
