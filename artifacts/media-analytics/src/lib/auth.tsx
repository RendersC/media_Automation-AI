import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Role = "admin" | "employee";

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
}

export interface ManagedUser extends AuthUser {
  createdAt: string;
}

// Same-origin by default; set VITE_API_URL when the backend is on another origin.
const API = (import.meta.env.VITE_API_URL?.trim() || "") + "/api";

/** fetch wrapper: same-origin cookies, JSON in/out, throws Error(message) on failure. */
async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    ...options,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Ошибка ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

// --- Auth API ---
export const authApi = {
  me: () => req<{ user: AuthUser }>("/auth/me").then((r) => r.user),
  login: (email: string, password: string) =>
    req<{ user: AuthUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }).then((r) => r.user),
  logout: () => req<void>("/auth/logout", { method: "POST" }),
  changePassword: (currentPassword: string, newPassword: string) =>
    req<{ ok: true }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};

// --- Admin user-management API ---
export const usersApi = {
  list: () => req<ManagedUser[]>("/users"),
  create: (body: { email: string; name?: string; role: Role; password: string }) =>
    req<ManagedUser>("/users", { method: "POST", body: JSON.stringify(body) }),
  update: (id: number, body: { name?: string; role?: Role; isActive?: boolean }) =>
    req<ManagedUser>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  resetPassword: (id: number, newPassword: string) =>
    req<{ ok: true }>(`/users/${id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ newPassword }),
    }),
  remove: (id: number) => req<void>(`/users/${id}`, { method: "DELETE" }),
};

// --- Auth context ---
interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser(await authApi.me());
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    setUser(await authApi.login(email, password));
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
