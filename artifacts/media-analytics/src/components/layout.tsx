import React from "react";
import { Link, useLocation } from "wouter";
import { Database, FileText, Home, Plus, Users, LogOut, UserCircle } from "lucide-react";
import logoUrl from "@/assets/logo.png";
import { useAuth } from "@/lib/auth";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const navItems = [
    { href: "/", label: "Главная", icon: Home },
    { href: "/sessions", label: "Сессии", icon: FileText },
    { href: "/directories", label: "Справочники", icon: Database },
    ...(user?.role === "admin" ? [{ href: "/admin/users", label: "Пользователи", icon: Users }] : []),
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="w-64 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-sidebar-border gap-3">
          <img src={logoUrl} alt="Логотип" className="w-8 h-8 rounded-md shrink-0" />
          <span className="font-semibold tracking-wide text-sm uppercase">ГОСАНАЛИТИКА МЕДИА</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
          {navItems.map((item) => {
            const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer ${
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  <span className="text-sm">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-sidebar-border space-y-2">
          <Link href="/sessions/new">
            <div className="flex items-center justify-center gap-2 w-full bg-sidebar-primary text-sidebar-primary-foreground py-2 px-4 rounded-md text-sm font-medium hover:bg-sidebar-primary/90 transition-colors cursor-pointer">
              <Plus className="w-4 h-4" />
              <span>Новая сессия</span>
            </div>
          </Link>

          {user && (
            <div className="pt-2 border-t border-sidebar-border/60">
              <Link href="/profile">
                <div className="flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer hover:bg-sidebar-accent/50">
                  <UserCircle className="w-5 h-5 shrink-0 text-sidebar-foreground/70" />
                  <div className="min-w-0">
                    <div className="text-sm truncate">{user.name || user.email}</div>
                    <div className="text-xs text-sidebar-foreground/60">
                      {user.role === "admin" ? "Администратор" : "Работник"}
                    </div>
                  </div>
                </div>
              </Link>
              <button
                onClick={() => void logout()}
                className="mt-1 flex items-center gap-2 w-full px-2 py-2 rounded-md text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Выйти</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}
