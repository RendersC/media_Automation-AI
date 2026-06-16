import crypto from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db, usersTable, authSessionsTable, type User } from "@workspace/db";
import { logger } from "./logger";

// --- Password hashing (scrypt — built into Node, no native dependency) ---

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// --- Sessions (random token stored in an httpOnly cookie + DB row) ---

export const SESSION_COOKIE = "sid";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  role: string;
  isActive: boolean;
  mustChangePassword: boolean;
}

export function toAuthUser(u: User): AuthUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    role: u.role,
    isActive: u.isActive === 1,
    mustChangePassword: u.mustChangePassword === 1,
  };
}

export async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(authSessionsTable).values({ token, userId, expiresAt });
  return { token, expiresAt };
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(authSessionsTable).where(eq(authSessionsTable.token, token));
}

export async function deleteUserSessions(userId: number): Promise<void> {
  await db.delete(authSessionsTable).where(eq(authSessionsTable.userId, userId));
}

/** Resolve the user behind a session token, or null if invalid/expired/inactive. */
export async function getUserByToken(token: string): Promise<AuthUser | null> {
  const [session] = await db
    .select()
    .from(authSessionsTable)
    .where(and(eq(authSessionsTable.token, token), gt(authSessionsTable.expiresAt, new Date())));
  if (!session) return null;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId));
  if (!user || user.isActive !== 1) return null;
  return toAuthUser(user);
}

/**
 * Cookie options for the session cookie.
 * - COOKIE_SAMESITE: "lax" (default), "strict" or "none". Use "none" when the
 *   frontend is on a different site (e.g. Vercel) than the API (e.g. Railway).
 * - COOKIE_SECURE: "true" over HTTPS. SameSite=None always implies Secure.
 */
export function sessionCookieOptions(expires?: Date) {
  const sameSiteEnv = process.env.COOKIE_SAMESITE?.toLowerCase();
  const sameSite =
    sameSiteEnv === "none" || sameSiteEnv === "strict" || sameSiteEnv === "lax" ? sameSiteEnv : "lax";
  const secure = process.env.COOKIE_SECURE === "true" || sameSite === "none";
  return {
    httpOnly: true,
    sameSite: sameSite as "lax" | "strict" | "none",
    secure,
    path: "/",
    ...(expires ? { expires } : {}),
  };
}

/**
 * Seed the first admin from ADMIN_EMAIL / ADMIN_PASSWORD on startup if that user
 * doesn't exist yet. Idempotent and safe to call on every boot.
 */
export async function ensureAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    logger.warn("ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping initial admin bootstrap");
    return;
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) return;

  await db.insert(usersTable).values({
    email,
    name: "Администратор",
    passwordHash: hashPassword(password),
    role: "admin",
    isActive: 1,
    mustChangePassword: 0,
  });
  logger.info({ email }, "Seeded initial admin user");
}
