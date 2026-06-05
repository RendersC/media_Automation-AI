import React, { useState } from "react";
import { 
  useListDirectories, 
  useCreateDirectory,
  useDeleteDirectory,
  getListDirectoriesQueryKey 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Database, Plus, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FileUploadButton } from "@/components/FileUploadButton";

export default function Directories() {
  const { data: directories, isLoading } = useListDirectories();
  const createDir = useCreateDirectory();
  const deleteDir = useDeleteDirectory();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const [name, setName] = useState("");
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [rawText, setRawText] = useState("");
  const [inputMode, setInputMode] = useState<"file" | "text">("file");

  const resetForm = () => {
    setName("");
    setRawText("");
    setYear(new Date().getFullYear().toString());
    setInputMode("file");
  };

  const handleCreate = () => {
    if (!name || !year || !rawText.trim()) {
      toast({ title: "Ошибка", description: "Заполните все поля и укажите текст справочника", variant: "destructive" });
      return;
    }

    createDir.mutate({
      data: { name, year: parseInt(year, 10), rawText }
    }, {
      onSuccess: () => {
        toast({ title: "Успешно", description: "Справочник загружен" });
        queryClient.invalidateQueries({ queryKey: getListDirectoriesQueryKey() });
        setOpen(false);
        resetForm();
      },
      onError: () => {
        toast({ title: "Ошибка", description: "Не удалось загрузить справочник", variant: "destructive" });
      }
    });
  };

  const handleDelete = (id: number, dirName: string) => {
    deleteDir.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Удалён", description: `Справочник «${dirName}» удалён` });
        queryClient.invalidateQueries({ queryKey: getListDirectoriesQueryKey() });
      },
      onError: () => {
        toast({ title: "Ошибка", description: "Не удалось удалить справочник", variant: "destructive" });
      }
    });
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Справочники</h1>
          <p className="text-muted-foreground mt-1">Управление тематическими направлениями.</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              Добавить справочник
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Загрузить новый справочник</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-4 gap-4">
                <div className="col-span-3 space-y-2">
                  <Label>Название</Label>
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder="Например: Перечень тем ТВ..." />
                </div>
                <div className="space-y-2">
                  <Label>Год</Label>
                  <Input type="number" value={year} onChange={e => setYear(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Перечень тем</Label>
                <Tabs value={inputMode} onValueChange={(v) => setInputMode(v as "file" | "text")}>
                  <TabsList className="mb-3">
                    <TabsTrigger value="file">Файл (PDF / DOCX / TXT)</TabsTrigger>
                    <TabsTrigger value="text">Вставить текст</TabsTrigger>
                  </TabsList>
                  <TabsContent value="file" className="mt-0 space-y-3">
                    <FileUploadButton
                      label="Загрузить файл перечня тем"
                      onTextExtracted={(text) => setRawText(text)}
                    />
                    {rawText && (
                      <div className="rounded-md bg-muted p-3 max-h-40 overflow-y-auto">
                        <p className="text-xs text-muted-foreground mb-1">Извлечённый текст ({rawText.length} симв.):</p>
                        <pre className="text-xs whitespace-pre-wrap font-mono">{rawText.slice(0, 800)}{rawText.length > 800 ? "\n…" : ""}</pre>
                      </div>
                    )}
                  </TabsContent>
                  <TabsContent value="text" className="mt-0">
                    <Textarea
                      className="min-h-[200px] font-mono text-sm"
                      value={rawText}
                      onChange={e => setRawText(e.target.value)}
                      placeholder="Вставьте текст с категориями..."
                    />
                  </TabsContent>
                </Tabs>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setOpen(false); resetForm(); }}>Отмена</Button>
              <Button onClick={handleCreate} disabled={createDir.isPending || !rawText.trim()}>
                {createDir.isPending ? "Загрузка..." : "Сохранить"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Доступные справочники</CardTitle>
          <CardDescription>Справочники используются для разметки сюжетов ИИ-моделью.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
          ) : directories && directories.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead>Год</TableHead>
                  <TableHead>Категорий</TableHead>
                  <TableHead>Дата добавления</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {directories.map(dir => (
                  <TableRow key={dir.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Database className="w-4 h-4 text-muted-foreground shrink-0" />
                        {dir.name}
                      </div>
                    </TableCell>
                    <TableCell>{dir.year}</TableCell>
                    <TableCell>{dir.categoriesCount}</TableCell>
                    <TableCell>{new Date(dir.createdAt).toLocaleDateString("ru-RU")}</TableCell>
                    <TableCell>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            disabled={deleteDir.isPending}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Удалить справочник?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Справочник «{dir.name}» и все его категории ({dir.categoriesCount}) будут удалены безвозвратно. Сессии, использующие этот справочник, останутся, но потеряют привязку к категориям.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Отмена</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => handleDelete(dir.id, dir.name)}
                            >
                              Удалить
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Database className="w-12 h-12 mx-auto text-muted mb-4" />
              <p>Нет загруженных справочников.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
