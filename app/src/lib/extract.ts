export async function extractText(buf: Buffer, mime: string, filename: string): Promise<string> {
  const name = filename.toLowerCase();
  try {
    if (mime === "application/pdf" || name.endsWith(".pdf")) {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      try {
        return (await parser.getText()).text.trim();
      } finally {
        await parser.destroy();
      }
    }
    if (name.endsWith(".docx") || mime.includes("wordprocessingml")) {
      const mammoth = await import("mammoth");
      return (await mammoth.extractRawText({ buffer: buf })).value.trim();
    }
    if (mime.startsWith("text/") || /\.(txt|md|csv|json|xml|html?)$/.test(name)) {
      return buf.toString("utf8").trim();
    }
  } catch (err) {
    console.error("Tekstextractie mislukt", filename, err);
  }
  return "";
}

export async function docxToHtml(buf: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  return (await mammoth.convertToHtml({ buffer: buf })).value;
}
