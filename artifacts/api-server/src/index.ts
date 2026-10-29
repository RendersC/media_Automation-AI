import { inArray, lt } from "drizzle-orm";
import { db, pool, sessionsTable, authSessionsTable } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { ensureAdmin } from "./lib/auth";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * Video jobs run in-process, so a restart/redeploy kills them mid-flight and
 * their sessions would spin in "transcribing" forever. Nothing can be running
 * at boot, so mark them failed with a message the user can act on.
 */
async function failInterruptedJobs(): Promise<void> {
  const rows = await db
    .update(sessionsTable)
    .set({
      status: "error",
      progressMessage: "Обработка прервана перезапуском сервера. Создайте сессию заново.",
    })
    .where(inArray(sessionsTable.status, ["transcribing", "processing"]))
    .returning({ id: sessionsTable.id });
  if (rows.length > 0) {
    logger.warn({ sessionIds: rows.map((r) => r.id) }, "Marked interrupted sessions as failed");
  }
}

async function purgeExpiredAuthSessions(): Promise<void> {
  await db.delete(authSessionsTable).where(lt(authSessionsTable.expiresAt, new Date()));
}

async function start(): Promise<void> {
  // Seed the initial admin (from ADMIN_EMAIL/ADMIN_PASSWORD) before serving.
  try {
    await ensureAdmin();
  } catch (err) {
    logger.error({ err }, "Initial admin bootstrap failed");
  }

  try {
    await failInterruptedJobs();
    await purgeExpiredAuthSessions();
  } catch (err) {
    logger.error({ err }, "Startup housekeeping failed");
  }

  const server = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });

  // Railway sends SIGTERM on redeploy: stop accepting requests, close the pool.
  process.once("SIGTERM", () => {
    logger.info("SIGTERM received, shutting down");
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

void start();
