import mammoth from "mammoth";

export async function extractTextFromBuffer(
  buffer: Buffer,
  mimetype: string,
  originalname: string
): Promise<string> {
  const ext = originalname.split(".").pop()?.toLowerCase() ?? "";

  if (mimetype === "text/plain" || ext === "txt") {
    return buffer.toString("utf-8");
  }

  if (
    mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (mimetype === "application/pdf" || ext === "pdf") {
    // pdf-parse v2 has a class-based API (PDFParse, backed by pdfjs), not the
    // v1 callable. Dynamic import keeps it external to the esbuild bundle.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { PDFParse } = (await import("pdf-parse")) as any;
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return result.text as string;
    } finally {
      await parser.destroy();
    }
  }

  throw new Error(`Неподдерживаемый формат файла: ${ext || mimetype}`);
}
