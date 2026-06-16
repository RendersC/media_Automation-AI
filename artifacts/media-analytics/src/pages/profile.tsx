import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { useAuth } from "@/lib/auth";

export default function Profile() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-foreground">Профиль</h1>

      <Card>
        <CardHeader>
          <CardTitle>Учётная запись</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">Email:</span> {user.email}</p>
          <p><span className="text-muted-foreground">Имя:</span> {user.name || "—"}</p>
          <p><span className="text-muted-foreground">Роль:</span> {user.role === "admin" ? "Администратор" : "Работник"}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Смена пароля</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
