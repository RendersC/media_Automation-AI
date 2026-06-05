import React, { useState } from "react";
import { useLocation } from "wouter";
import {
  useListDirectories,
  useCreateSession,
  useGetSession,
  getGetSessionQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FileText, ArrowRight, Activity, Link2, AlertCircle } from "lucide-react";
import { FileUploadButton } from "@/components/FileUploadButton";

export default function NewSession() {
  const [step, setStep] = useState(1);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: directories, isLoading: dirsLoading } = useListDirectories();
  const createSession = useCreateSession();

  const [programName, setProgramName] = useState("");
  const [broadcastDate, setBroadcastDate] = useState("");
  const [directoryId, setDirectoryId] = useState<string>("");

  const [broadcastInputMode, setBroadcastInputMode] = useState<"file" | "text">("file");
  const [broadcastText, setBroadcastText] = useState("");
  const [videoUrl, setVideoUrl] = useState("");

  const [createdSessionId, setCreatedSessionId] = useState<number | null>(null);

  const handleNextStep1 = () => {
    if (!directoryId) {
      toast({ title: "Ошибка", description: "Выберите справочник направлений", variant: "destructive" });
      return;
    }
    setStep(2);
  };

  const handleCreateAndProcess = async () => {
    if (!broadcastText.trim()) {
      toast({ title: "Ошибка", description: "Загрузите файл или вставьте текст вёрстки", variant: "destructive" });
      return;
    }
    if (!videoUrl.trim()) {
      toast({ title: "Ошибка", description: "Вставьте ссылку на видео (файл .mp4 или YouTube)", variant: "destructive" });
      return;
    }

    try {
      const session = await createSession.mutateAsync({
        data: {
          programName: programName.trim() || undefined,
          broadcastDate: broadcastDate.trim() || undefined,
          directoryId: parseInt(directoryId, 10),
          broadcastText: broadcastText,
          videoUrl: videoUrl.trim(),
        }
      });

      setCreatedSessionId(session.id);
      setStep(3);
    } catch {
      toast({ title: "Ошибка", description: "Не удалось создать сессию", variant: "destructive" });
      setStep(2);
    }
  };

  const isProcessing = createSession.isPending;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Новая сессия</h1>
        <p className="text-muted-foreground mt-1">Справочник + вёрстка + видео — платформа соберёт итоговую таблицу</p>
      </div>

      <div className="flex items-center justify-between mb-8 relative">
        <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-muted -z-10" />
        {[1, 2, 3].map(s => (
          <div
            key={s}
            className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm z-10 ${
              step >= s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground border-2 border-background"
            }`}
          >
            {s}
          </div>
        ))}
      </div>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Шаг 1: Справочник направлений</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Справочник направлений</Label>
              <Select value={directoryId} onValueChange={setDirectoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите справочник" />
                </SelectTrigger>
                <SelectContent>
                  {dirsLoading ? (
                    <SelectItem value="loading" disabled>Загрузка...</SelectItem>
                  ) : directories?.map(d => (
                    <SelectItem key={d.id} value={d.id.toString()}>{d.name} ({d.year})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                ИИ определит тематическое направление каждого сюжета из этого справочника.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Название программы / эфира <span className="text-muted-foreground font-normal">(необязательно)</span></Label>
              <Input
                value={programName}
                onChange={e => setProgramName(e.target.value)}
                placeholder="Оставьте пустым — ИИ определит из вёрстки и видео"
              />
            </div>
            <div className="space-y-2">
              <Label>Дата эфира <span className="text-muted-foreground font-normal">(необязательно)</span></Label>
              <Input
                type="date"
                value={broadcastDate}
                onChange={e => setBroadcastDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Обычно определяется автоматически из имени видеофайла.
              </p>
            </div>

            <div className="pt-4 flex justify-end">
              <Button onClick={handleNextStep1} className="gap-2">
                Далее
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Шаг 2: Вёрстка и видео</CardTitle>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Вёрстка эфира
              </Label>
              <p className="text-xs text-muted-foreground">
                Из вёрстки ИИ берёт темы передач (ключевую мысль и спикера) для каждого сюжета.
              </p>
              <Tabs value={broadcastInputMode} onValueChange={(v) => setBroadcastInputMode(v as "file" | "text")}>
                <TabsList className="mb-3">
                  <TabsTrigger value="file">Файл (PDF / DOCX / TXT)</TabsTrigger>
                  <TabsTrigger value="text">Вставить текст</TabsTrigger>
                </TabsList>
                <TabsContent value="file" className="mt-0 space-y-3">
                  <FileUploadButton
                    label="Загрузить вёрстку главных новостей"
                    onTextExtracted={(text) => setBroadcastText(text)}
                  />
                  {broadcastText && (
                    <div className="rounded-md bg-muted p-3 max-h-48 overflow-y-auto">
                      <p className="text-xs text-muted-foreground mb-1">Извлечённый текст ({broadcastText.length} симв.):</p>
                      <pre className="text-xs whitespace-pre-wrap font-mono">{broadcastText.slice(0, 1000)}{broadcastText.length > 1000 ? "\n…" : ""}</pre>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="text" className="mt-0">
                  <Textarea
                    className="min-h-[260px]"
                    value={broadcastText}
                    onChange={e => setBroadcastText(e.target.value)}
                    placeholder="Вставьте полный текст вёрстки эфира со списком сюжетов..."
                  />
                </TabsContent>
              </Tabs>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Link2 className="w-4 h-4" />
                Ссылка на видео
              </Label>
              <Input
                value={videoUrl}
                onChange={e => setVideoUrl(e.target.value)}
                placeholder="https://1tv.kz/.../04-06-26-EFIR.mp4  или  https://youtube.com/watch?v=…"
              />
              <p className="text-xs text-muted-foreground">
                Подойдёт прямая ссылка на файл (.mp4 и потоки) или ссылка на YouTube. Из видео платформа
                берёт хронометраж сюжетов (по расшифровке речи) и дату выхода (из имени файла или даты
                загрузки на YouTube). Обработка часового эфира занимает несколько минут.
              </p>
              <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  YouTube загружается через yt-dlp; для некоторых видео (приватные, с ограничениями или
                  при блокировке со стороны YouTube) загрузка может не сработать — тогда используйте прямую ссылку на файл.
                </span>
              </div>
            </div>

            <div className="pt-4 flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>Назад</Button>
              <Button
                onClick={handleCreateAndProcess}
                disabled={isProcessing}
                className="gap-2 bg-primary text-primary-foreground"
              >
                {isProcessing ? "Создание..." : "Создать и обработать"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && createdSessionId !== null && (
        <VideoProcessing sessionId={createdSessionId} />
      )}

    </div>
  );
}

function VideoProcessing({ sessionId }: { sessionId: number }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const notified = React.useRef(false);

  const { data: session } = useGetSession(sessionId, {
    query: {
      queryKey: getGetSessionQueryKey(sessionId),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "done" || status === "error" ? false : 3000;
      },
    },
  });

  React.useEffect(() => {
    if (!session || notified.current) return;
    if (session.status === "done") {
      notified.current = true;
      toast({ title: "Готово", description: "Эфир расшифрован и размечен ИИ" });
      setLocation(`/sessions/${sessionId}`);
    } else if (session.status === "error") {
      notified.current = true;
      toast({
        title: "Ошибка обработки",
        description: session.progressMessage ?? "Не удалось обработать видео",
        variant: "destructive",
      });
      setLocation(`/sessions/${sessionId}`);
    }
  }, [session, sessionId, setLocation, toast]);

  const isError = session?.status === "error";
  const statusLabel =
    session?.status === "transcribing"
      ? "Расшифровка речи и сопоставление с вёрсткой"
      : session?.status === "processing"
        ? "Классификация сюжетов ИИ"
        : "Подготовка";

  return (
    <Card className={isError ? "border-destructive" : "border-primary"}>
      <CardContent className="pt-6 pb-8 text-center space-y-4">
        {isError ? (
          <AlertCircle className="w-12 h-12 text-destructive mx-auto" />
        ) : (
          <Activity className="w-12 h-12 text-primary mx-auto animate-pulse" />
        )}
        <h2 className="text-2xl font-bold">
          {isError ? "Не удалось обработать видео" : "Обработка эфира"}
        </h2>
        {!isError && (
          <p className="text-sm font-medium text-primary">{statusLabel}</p>
        )}
        <p className="text-muted-foreground max-w-md mx-auto">
          {session?.progressMessage ??
            "Платформа скачивает звук, расшифровывает речь и сопоставляет её с вёрсткой. Обработка часового эфира занимает несколько минут."}
        </p>
      </CardContent>
    </Card>
  );
}
