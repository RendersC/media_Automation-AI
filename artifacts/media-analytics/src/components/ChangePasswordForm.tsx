import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi, useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

export function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const { refresh } = useAuth();
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 6) {
      setError("Новый пароль должен быть не короче 6 символов");
      return;
    }
    if (next !== confirm) {
      setError("Пароли не совпадают");
      return;
    }
    setBusy(true);
    try {
      await authApi.changePassword(current, next);
      await refresh();
      toast({ title: "Готово", description: "Пароль изменён" });
      setCurrent("");
      setNext("");
      setConfirm("");
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить пароль");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 max-w-sm">
      <div className="space-y-2">
        <Label htmlFor="cur">Текущий пароль</Label>
        <Input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="np">Новый пароль</Label>
        <Input id="np" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cp">Повторите новый пароль</Label>
        <Input id="cp" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy}>{busy ? "Сохранение…" : "Сменить пароль"}</Button>
    </form>
  );
}
