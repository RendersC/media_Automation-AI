import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { UserPlus, KeyRound, Trash2 } from "lucide-react";
import { usersApi, useAuth, type ManagedUser, type Role } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

export default function AdminUsers() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    try {
      setUsers(await usersApi.list());
    } catch (e) {
      toast({ title: "Ошибка", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void reload(); }, []);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast({ title: "Готово", description: ok });
      await reload();
    } catch (e) {
      toast({ title: "Ошибка", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-foreground">Пользователи</h1>
        <CreateUserDialog onCreated={reload} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Учётные записи ({users.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Имя</TableHead>
                <TableHead className="w-40">Роль</TableHead>
                <TableHead className="w-32">Статус</TableHead>
                <TableHead className="w-56 text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const self = u.id === me?.id;
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.email}{self && <span className="text-muted-foreground"> (вы)</span>}
                    </TableCell>
                    <TableCell>{u.name || "—"}</TableCell>
                    <TableCell>
                      <Select
                        value={u.role}
                        onValueChange={(role) => act(() => usersApi.update(u.id, { role: role as Role }), "Роль обновлена")}
                      >
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Администратор</SelectItem>
                          <SelectItem value="employee">Работник</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={u.isActive ? "secondary" : "outline"} className="w-fit">
                          {u.isActive ? "Активен" : "Отключён"}
                        </Badge>
                        {u.mustChangePassword && (
                          <span className="text-xs text-amber-600">сменит пароль</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="outline" size="sm"
                          disabled={self}
                          onClick={() => act(() => usersApi.update(u.id, { isActive: !u.isActive }), "Статус обновлён")}
                        >
                          {u.isActive ? "Отключить" : "Включить"}
                        </Button>
                        <ResetPasswordDialog user={u} onDone={reload} />
                        <Button
                          variant="ghost" size="icon"
                          disabled={self}
                          onClick={() => {
                            if (confirm(`Удалить пользователя ${u.email}?`)) {
                              void act(() => usersApi.remove(u.id), "Пользователь удалён");
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && users.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Нет пользователей</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function CreateUserDialog({ onCreated }: { onCreated: () => Promise<void> }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await usersApi.create({ email: email.trim(), name: name.trim() || undefined, role, password });
      toast({ title: "Готово", description: "Пользователь создан. Он сменит пароль при первом входе." });
      setOpen(false);
      setEmail(""); setName(""); setRole("employee"); setPassword("");
      await onCreated();
    } catch (e) {
      toast({ title: "Ошибка", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2"><UserPlus className="w-4 h-4" /> Добавить</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Новый пользователь</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="worker@example.kz" /></div>
          <div className="space-y-2"><Label>Имя</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ФИО (необязательно)" /></div>
          <div className="space-y-2">
            <Label>Роль</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="employee">Работник</SelectItem>
                <SelectItem value="admin">Администратор</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Временный пароль</Label>
            <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="мин. 6 символов" />
            <p className="text-xs text-muted-foreground">Передайте его работнику — он сменит пароль при первом входе.</p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy}>{busy ? "Создание…" : "Создать"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onDone }: { user: ManagedUser; onDone: () => Promise<void> }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await usersApi.resetPassword(user.id, pwd);
      toast({ title: "Готово", description: "Пароль сброшен. Пользователь сменит его при входе." });
      setOpen(false); setPwd("");
      await onDone();
    } catch (e) {
      toast({ title: "Ошибка", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" title="Сбросить пароль"><KeyRound className="w-4 h-4" /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Сброс пароля — {user.email}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>Новый временный пароль</Label>
          <Input type="text" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="мин. 6 символов" />
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy}>{busy ? "Сохранение…" : "Сбросить"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
