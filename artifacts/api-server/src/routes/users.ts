import { Router, type IRouter } from "express";
import { and, eq, ne, count } from "drizzle-orm";
import { db, usersTable, USER_ROLES } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { hashPassword, deleteUserSessions } from "../lib/auth";

const router: IRouter = Router();

const MIN_PASSWORD_LENGTH = 6;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(u: {
  id: number;
  email: string;
  name: string | null;
  role: string;
  isActive: number;
  mustChangePassword: number;
  createdAt: Date;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    role: u.role,
    isActive: u.isActive === 1,
    mustChangePassword: u.mustChangePassword === 1,
    createdAt: u.createdAt.toISOString(),
  };
}

/** Number of active admins (used to prevent locking out the last admin). */
async function activeAdminCount(excludeId?: number): Promise<number> {
  const where = excludeId
    ? and(eq(usersTable.role, "admin"), eq(usersTable.isActive, 1), ne(usersTable.id, excludeId))
    : and(eq(usersTable.role, "admin"), eq(usersTable.isActive, 1));
  const [{ c }] = await db.select({ c: count() }).from(usersTable).where(where);
  return Number(c);
}

// All routes below are admin-only.
router.use("/users", requireAuth, requireAdmin);

router.get("/users", async (_req, res): Promise<void> => {
  const rows = await db.select().from(usersTable).orderBy(usersTable.createdAt);
  res.json(rows.map(publicUser));
});

router.post("/users", async (req, res): Promise<void> => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const role = typeof req.body?.role === "string" ? req.body.role : "employee";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: "Некорректный email" });
    return;
  }
  if (!(USER_ROLES as readonly string[]).includes(role)) {
    res.status(400).json({ error: "Недопустимая роль" });
    return;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов` });
    return;
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "Пользователь с таким email уже существует" });
    return;
  }

  const [created] = await db
    .insert(usersTable)
    .values({
      email,
      name: name || null,
      passwordHash: hashPassword(password),
      role,
      isActive: 1,
      // Admin-set password is temporary — the user must change it on first login.
      mustChangePassword: 1,
    })
    .returning();

  res.status(201).json(publicUser(created));
});

router.patch("/users/:id", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Некорректный id" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) {
    res.status(404).json({ error: "Пользователь не найден" });
    return;
  }

  const updates: { name?: string | null; role?: string; isActive?: number } = {};

  if (req.body?.name !== undefined) {
    updates.name = typeof req.body.name === "string" && req.body.name.trim() ? req.body.name.trim() : null;
  }
  if (req.body?.role !== undefined) {
    if (!(USER_ROLES as readonly string[]).includes(req.body.role)) {
      res.status(400).json({ error: "Недопустимая роль" });
      return;
    }
    updates.role = req.body.role;
  }
  if (req.body?.isActive !== undefined) {
    updates.isActive = req.body.isActive ? 1 : 0;
  }

  // Guard: never leave the system without an active admin.
  const demotesAdmin = updates.role !== undefined && updates.role !== "admin" && user.role === "admin";
  const deactivatesAdmin = updates.isActive === 0 && user.role === "admin";
  if ((demotesAdmin || deactivatesAdmin) && (await activeAdminCount(id)) === 0) {
    res.status(400).json({ error: "Нельзя оставить систему без активного администратора" });
    return;
  }
  if (req.user!.id === id && updates.isActive === 0) {
    res.status(400).json({ error: "Нельзя деактивировать собственную учётную запись" });
    return;
  }

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  // If the user was deactivated or demoted, drop their active sessions.
  if (updates.isActive === 0 || demotesAdmin) await deleteUserSessions(id);
  res.json(publicUser(updated));
});

router.post("/users/:id/reset-password", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Некорректный id" });
    return;
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов` });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) {
    res.status(404).json({ error: "Пользователь не найден" });
    return;
  }

  await db
    .update(usersTable)
    .set({ passwordHash: hashPassword(newPassword), mustChangePassword: 1 })
    .where(eq(usersTable.id, id));
  await deleteUserSessions(id);
  res.json({ ok: true });
});

router.delete("/users/:id", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Некорректный id" });
    return;
  }
  if (req.user!.id === id) {
    res.status(400).json({ error: "Нельзя удалить собственную учётную запись" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) {
    res.status(404).json({ error: "Пользователь не найден" });
    return;
  }
  if (user.role === "admin" && (await activeAdminCount(id)) === 0) {
    res.status(400).json({ error: "Нельзя удалить последнего администратора" });
    return;
  }

  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.sendStatus(204);
});

export default router;
