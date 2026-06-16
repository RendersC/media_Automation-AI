import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, FileText, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface FileUploadButtonProps {
  onTextExtracted: (text: string) => void;
  label?: string;
}

// Same base as the rest of the API client; empty → same-origin (local/Docker).
const API_BASE = import.meta.env.VITE_API_URL?.trim() || "";

const ACCEPTED = ".txt,.pdf,.docx";
const ACCEPT_MIME = [
  "text/plain",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export function FileUploadButton({ onTextExtracted, label = "Загрузить файл" }: FileUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const { toast } = useToast();

  const handleFile = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ACCEPT_MIME.includes(file.type) && !["txt", "pdf", "docx"].includes(ext)) {
      toast({ title: "Неверный формат", description: "Поддерживаются: PDF, DOCX, TXT", variant: "destructive" });
      return;
    }

    setLoading(true);
    setFileName(file.name);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API_BASE}/api/upload-document`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Ошибка сервера");
      }
      const { text } = await res.json() as { text: string };
      onTextExtracted(text);
      toast({ title: "Файл загружен", description: `Извлечён текст из "${file.name}"` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Не удалось прочитать файл";
      toast({ title: "Ошибка загрузки", description: msg, variant: "destructive" });
      setFileName(null);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const clear = (ev: React.MouseEvent) => {
    ev.stopPropagation();
    setFileName(null);
    onTextExtracted("");
  };

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="border-2 border-dashed border-border rounded-lg px-4 py-3 flex items-center gap-3 hover:border-primary/60 transition-colors cursor-pointer bg-muted/30"
      onClick={() => !loading && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={handleChange}
      />
      {loading ? (
        <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
      ) : fileName ? (
        <FileText className="w-5 h-5 text-primary shrink-0" />
      ) : (
        <Upload className="w-5 h-5 text-muted-foreground shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        {loading ? (
          <span className="text-sm text-muted-foreground">Извлечение текста...</span>
        ) : fileName ? (
          <span className="text-sm font-medium truncate block">{fileName}</span>
        ) : (
          <span className="text-sm text-muted-foreground">
            {label} — <span className="text-xs">PDF, DOCX, TXT (до 20 МБ)</span>
          </span>
        )}
      </div>
      {fileName && !loading && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={clear}
        >
          <X className="w-3 h-3" />
        </Button>
      )}
    </div>
  );
}
