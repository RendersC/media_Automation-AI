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
    // Dynamic import to avoid ESM/CJS bundling issues; handle both CJS default and ESM named exports
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import("pdf-parse")) as any;
    const pdfParse: (buf: Buffer) => Promise<{ text: string }> = mod.default ?? mod;
    const data = await pdfParse(buffer);
    return data.text;
  }

  throw new Error(`Неподдерживаемый формат файла: ${ext || mimetype}`);
}
