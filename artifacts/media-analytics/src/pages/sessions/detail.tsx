import React, { useEffect, useState } from "react";
import { useParams } from "wouter";
import { 
  useGetSession, 
  useListCategories, 
  useUpdateSegment,
  useExportReport,
  getGetSessionQueryKey,
  useProcessSession
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, Edit2, Check, RefreshCw, Tag, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function SessionDetail() {
  const { id: idStr } = useParams();
  const id = parseInt(idStr || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: session, isLoading } = useGetSession(id, { 
    query: { enabled: !!id, queryKey: getGetSessionQueryKey(id) } 
  });

  const dirId = session?.directoryId || 0;
  const { data: categories } = useListCategories(dirId, {
    query: { enabled: !!session?.directoryId, queryKey: ["directories", dirId, "categories"] }
  });

  const updateSegment = useUpdateSegment();
  const processSession = useProcessSession();
  const [editingSegment, setEditingSegment] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSpeaker, setEditSpeaker] = useState("");

  const handleStartEdit = (seg: any) => {
    setEditingSegment(seg.id);
    setEditTitle(seg.title);
    setEditSpeaker(seg.speaker || "");
  };

  const handleSaveEdit = (segId: number) => {
    updateSegment.mutate({
      id,
      segmentId: segId,
      data: { title: editTitle, speaker: editSpeaker }
    }, {
      onSuccess: () => {
        setEditingSegment(null);
        queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(id) });
        toast({ title: "Успешно", description: "Сюжет обновлен" });
      }
    });
  };

  const handleToggleCategory = (segId: number, currentIds: number[], categoryId: number) => {
    const nextIds = currentIds.includes(categoryId)
      ? currentIds.filter((c) => c !== categoryId)
      : [...currentIds, categoryId];
    updateSegment.mutate({
      id,
      segmentId: segId,
      data: { categoryIds: nextIds }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(id) });
      },
      onError: () => {
        toast({ title: "Ошибка", description: "Не удалось изменить направления", variant: "destructive" });
      }
    });
  };

  // Export
  const { refetch: fetchExport, isFetching: isExporting } = useExportReport(id, {
    query: { enabled: false, queryKey: ["sessions", id, "export"] }
  });

  const handleExport = async () => {
    try {
      const res = await fetchExport();
      if (res.data) {
        const { base64, filename } = res.data;
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
        
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
      }
    } catch (e) {
      toast({ title: "Ошибка", description: "Не удалось скачать отчет", variant: "destructive" });
    }
  };

  const handleReprocess = () => {
    processSession.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Успешно", description: "Запущена повторная разметка" });
        queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(id) });
      }
    });
  };

  if (isLoading || !session) {
    return <div className="p-8 text-center text-muted-foreground">Загрузка...</div>;
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{session.programName}</h1>
          <p className="text-muted-foreground mt-1">
            Эфир от {new Date(session.broadcastDate).toLocaleDateString("ru-RU")}
          </p>
        </div>
        <div className="flex gap-2">
          {session.status === 'processing' && (
            <Button variant="outline" disabled>В обработке...</Button>
          )}
          {session.status === 'done' && (
             <Button variant="outline" onClick={handleReprocess} className="gap-2">
               <RefreshCw className="w-4 h-4" />
               Повторить разметку
             </Button>
          )}
          <Button onClick={handleExport} disabled={isExporting || session.segments.length === 0} className="gap-2">
            <Download className="w-4 h-4" />
            {isExporting ? "Формирование..." : "Скачать Excel"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Размеченные сюжеты ({session.segments.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Время</TableHead>
                <TableHead className="w-1/4">Направление</TableHead>
                <TableHead>Сюжет (Ключевая мысль)</TableHead>
                <TableHead className="w-48">Спикер</TableHead>
                <TableHead className="w-24">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {session.segments.map(seg => (
                <TableRow key={seg.id} className={seg.manuallyEdited ? "bg-muted/20" : ""}>
                  <TableCell className="font-mono text-sm">
                    {seg.timeStart} - {seg.timeEnd}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {seg.categories.map((c) => (
                        <Badge key={c.id} variant="secondary" className="font-normal text-xs whitespace-normal text-left">
                          {c.title}
                        </Badge>
                      ))}
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 text-xs border-dashed text-muted-foreground"
                          >
                            {seg.categories.length === 0 ? (
                              <><Tag className="w-3 h-3" /> Выбрать направления</>
                            ) : (
                              <><Plus className="w-3 h-3" /> Изменить</>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-0" align="start">
                          <div className="px-3 py-2 border-b">
                            <p className="text-sm font-medium">Тематические направления</p>
                            <p className="text-xs text-muted-foreground">Можно выбрать несколько</p>
                          </div>
                          <ScrollArea className="h-72">
                            <div className="p-1">
                              {categories && categories.length > 0 ? (
                                categories.map((c) => {
                                  const checked = seg.categoryIds.includes(c.id);
                                  return (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() => handleToggleCategory(seg.id, seg.categoryIds, c.id)}
                                      className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                                    >
                                      <Checkbox checked={checked} className="mt-0.5 pointer-events-none" />
                                      <span className="leading-snug">{c.title}</span>
                                    </button>
                                  );
                                })
                              ) : (
                                <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                                  В справочнике нет категорий
                                </p>
                              )}
                            </div>
                          </ScrollArea>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </TableCell>
                  <TableCell>
                    {editingSegment === seg.id ? (
                      <Input 
                        value={editTitle} 
                        onChange={e => setEditTitle(e.target.value)} 
                        className="h-8 text-sm"
                        autoFocus
                      />
                    ) : (
                      <span className="text-sm font-medium">{seg.title}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {editingSegment === seg.id ? (
                      <Input 
                        value={editSpeaker} 
                        onChange={e => setEditSpeaker(e.target.value)} 
                        className="h-8 text-sm"
                        placeholder="Спикер"
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">{seg.speaker || "—"}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {editingSegment === seg.id ? (
                      <Button variant="ghost" size="icon" onClick={() => handleSaveEdit(seg.id)}>
                        <Check className="w-4 h-4 text-green-600" />
                      </Button>
                    ) : (
                      <Button variant="ghost" size="icon" onClick={() => handleStartEdit(seg)}>
                        <Edit2 className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {session.segments.length === 0 && session.status !== 'processing' && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Нет сюжетов. Попробуйте загрузить данные и запустить разметку.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
