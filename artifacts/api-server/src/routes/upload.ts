import { Router, type IRouter } from "express";
import multer from "multer";
import { extractTextFromBuffer } from "../lib/documentExtractor";

const router: IRouter = Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "text/plain",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    const ext = file.originalname.split(".").pop()?.toLowerCase() ?? "";
    if (allowed.includes(file.mimetype) || ["txt", "pdf", "docx"].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Поддерживаются только форматы: PDF, DOCX, TXT"));
    }
  },
});

router.post(
  "/upload-document",
  upload.single("file"),
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "Файл не передан" });
      return;
    }

    try {
      const text = await extractTextFromBuffer(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname
      );
      res.json({ text });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ошибка чтения файла";
      res.status(422).json({ error: message });
    }
  }
);

export default router;
