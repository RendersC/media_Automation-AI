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

router.post("/auth/login", async (req, res): Promise<void> => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !password) {
    res.status(400).json({ error: "Укажите email и пароль" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  // Same generic message whether the email is unknown or the password is wrong.
  if (!user || user.isActive !== 1 || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Неверный email или пароль" });
    return;
  }

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
