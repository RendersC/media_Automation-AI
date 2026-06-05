import React from "react";
import { useListSessions, useDeleteSession, getListSessionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "wouter";
import { FileText, Clock, CheckCircle2, PlayCircle, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function BadgeStatus({ status }: { status: string }) {
  if (status === 'done') {
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Завершено
      </span>
    );
  }
  if (status === 'processing') {
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">
        <PlayCircle className="w-3.5 h-3.5 animate-pulse" />
        В обработке
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">
      <Clock className="w-3.5 h-3.5" />
      Черновик
    </span>
  );
}

export default function SessionsList() {
  const { data: sessions, isLoading } = useListSessions();
  const deleteSession = useDeleteSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleDelete = (id: number) => {
    deleteSession.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Успешно", description: "Сессия удалена" });
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
      },
      onError: () => {
        toast({ title: "Ошибка", description: "Не удалось удалить сессию", variant: "destructive" });
      }
    });
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Сессии</h1>
          <p className="text-muted-foreground mt-1">Список загруженных программ и эфиров.</p>
        </div>
        <Link href="/sessions/new">
          <Button className="gap-2">
            <Plus className="w-4 h-4" />
            Создать сессию
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Все сессии</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
          ) : sessions && sessions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название программы</TableHead>
                  <TableHead>Дата эфира</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Сюжетов</TableHead>
                  <TableHead>Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map(session => (
                  <TableRow key={session.id}>
                    <TableCell className="font-medium flex items-center gap-2">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      {session.programName}
                    </TableCell>
                    <TableCell>{new Date(session.broadcastDate).toLocaleDateString("ru-RU")}</TableCell>
                    <TableCell>
                      <BadgeStatus status={session.status} />
                    </TableCell>
                    <TableCell>{session.segmentsCount}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Link href={`/sessions/${session.id}`}>
                          <Button variant="outline" size="sm">Открыть</Button>
                        </Link>
                        
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Удалить сессию?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Это действие нельзя отменить. Все размеченные сюжеты будут удалены.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Отмена</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={() => handleDelete(session.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Удалить
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto text-muted mb-4" />
              <p>Нет созданных сессий.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
