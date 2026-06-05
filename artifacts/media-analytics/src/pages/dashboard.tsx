import React from "react";
import { useListSessions, useListDirectories } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { FileText, Database, Activity, Plus, Clock, CheckCircle2, PlayCircle } from "lucide-react";

export default function Dashboard() {
  const { data: sessions, isLoading: sessionsLoading } = useListSessions();
  const { data: directories, isLoading: directoriesLoading } = useListDirectories();

  const totalSessions = sessions?.length || 0;
  const totalSegments = sessions?.reduce((acc, s) => acc + (s.segmentsCount || 0), 0) || 0;
  const totalDirectories = directories?.length || 0;

  const recentSessions = sessions?.slice(0, 5) || [];

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Сводка</h1>
          <p className="text-muted-foreground mt-1">Добро пожаловать в систему анализа медиаконтента.</p>
        </div>
        <Link href="/sessions/new">
          <Button size="lg" className="gap-2">
            <Plus className="w-4 h-4" />
            Новая сессия
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Всего сессий</CardTitle>
            <FileText className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sessionsLoading ? "..." : totalSessions}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Размечено сюжетов</CardTitle>
            <Activity className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sessionsLoading ? "..." : totalSegments}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Справочников</CardTitle>
            <Database className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{directoriesLoading ? "..." : totalDirectories}</div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Последние сессии</h2>
        <Card>
          {sessionsLoading ? (
            <div className="p-8 text-center text-muted-foreground">Загрузка...</div>
          ) : recentSessions.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">Нет данных. Создайте первую сессию.</div>
          ) : (
            <div className="divide-y border-t border-border mt-2">
              {recentSessions.map((session) => (
                <div key={session.id} className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-muted rounded-md">
                      <FileText className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <Link href={`/sessions/${session.id}`} className="font-medium text-foreground hover:underline">
                        {session.programName}
                      </Link>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                        <span>{new Date(session.broadcastDate).toLocaleDateString("ru-RU")}</span>
                        <span>&bull;</span>
                        <span>Сюжетов: {session.segmentsCount}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <BadgeStatus status={session.status} />
                    <Link href={`/sessions/${session.id}`}>
                      <Button variant="outline" size="sm">Открыть</Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

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
