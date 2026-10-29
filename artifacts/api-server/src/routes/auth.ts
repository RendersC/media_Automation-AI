import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  createSession,
  deleteSession,
  deleteUserSessions,
  verifyPassword,
  hashPassword,
  toAuthUser,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "../lib/auth";
import { requireAuth } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const MIN_PASSWORD_LENGTH = 6;

// Brute-force guard: per IP+email, at most LOGIN_MAX_FAILS failed attempts per
// window. In-memory is enough for the single-instance deploy.
const LOGIN_MAX_FAILS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginFails = new Map<string, { count: number; resetAt: number }>();

function loginKey(ip: string | undefined, email: string): string {
  return `${ip ?? "?"}|${email}`;
}

function isLoginBlocked(key: string): boolean {
  const entry = loginFails.get(key);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    loginFails.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILS;
}

function recordLoginFail(key: string): void {
  const now = Date.now();
  const entry = loginFails.get(key);
  if (!entry || entry.resetAt <= now) {
    loginFails.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.count += 1;
  }
  // Keep the map bounded.
  if (loginFails.size > 10_000) {
    for (const [k, v] of loginFails) if (v.resetAt <= now) loginFails.delete(k);
  }
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !password) {
    res.status(400).json({ error: "Укажите email и пароль" });
    return;
  }

  const key = loginKey(req.ip, email);
  if (isLoginBlocked(key)) {
    res.status(429).json({ error: "Слишком много попыток входа. Попробуйте через 15 минут" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  // Same generic message whether the email is unknown or the password is wrong.
  if (!user || user.isActive !== 1 || !verifyPassword(password, user.passwordHash)) {
    recordLoginFail(key);
    res.status(401).json({ error: "Неверный email или пароль" });
    return;
  }
  loginFails.delete(key);

  const { token, expiresAt } = await createSession(user.id);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  res.json({ user: toAuthUser(user) });
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  if (token) {
    try {
      await deleteSession(token);
    } catch (err) {
      logger.warn({ err }, "Failed to delete session on logout");
    }
  }
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  res.sendStatus(204);
});

router.get("/auth/me", requireAuth, (req, res): void => {
  res.json({ user: req.user });
});

router.post("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `Новый пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов` });
    return;
  }

  const userId = req.user!.id;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
    res.status(400).json({ error: "Текущий пароль указан неверно" });
    return;
  }

  await db
    .update(usersTable)
    .set({ passwordHash: hashPassword(newPassword), mustChangePassword: 0 })
    .where(eq(usersTable.id, userId));

  // Invalidate all other sessions, then re-issue one for the current device.
  await deleteUserSessions(userId);
  const { token, expiresAt } = await createSession(userId);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));

  res.json({ ok: true });
});

export default router;
