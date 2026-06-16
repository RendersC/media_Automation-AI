import type { Request, Response, NextFunction } from "express";
import { getUserByToken, SESSION_COOKIE, type AuthUser } from "../lib/auth";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Reject unless a valid session cookie resolves to an active user. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: "Требуется вход в систему" });
    return;
  }
  const user = await getUserByToken(token);
  if (!user) {
    res.status(401).json({ error: "Сессия недействительна или истекла" });
    return;
  }
  req.user = user;
  next();
}

/** Must run after requireAuth. Rejects non-admin users. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Доступ только для администратора" });
    return;
  }
  next();
}
