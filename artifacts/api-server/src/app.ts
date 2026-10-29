import fs from "node:fs";
import path from "node:path";
import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
// Behind Railway's / nginx's proxy: take req.ip from X-Forwarded-For.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Allow the configured frontend origin(s) to call the API with cookies.
// CORS_ORIGINS = comma-separated list (e.g. your Vercel URL). When unset, the
// request origin is reflected — fine for same-origin (Docker/local) use.
const corsOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
  }),
);
app.use(cookieParser());
// Вёрстка / справочник arrive as plain text in JSON; the 100kb default is too
// small for a long broadcast script extracted from DOCX/PDF.
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/api", router);

// Unknown /api routes → JSON 404 instead of the SPA's index.html.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Optional single-service deploy: serve the built frontend from the API so the
// UI and API share one origin (no Vercel, no cross-site cookies).
// STATIC_DIR = path to artifacts/media-analytics/dist/public.
const staticDir = process.env.STATIC_DIR?.trim();
if (staticDir && fs.existsSync(path.join(staticDir, "index.html"))) {
  // sendFile requires an absolute path.
  const indexHtml = path.resolve(staticDir, "index.html");
  app.use(express.static(staticDir, { index: false, maxAge: "1h" }));
  // SPA fallback for client-side routes (wouter).
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    res.sendFile(indexHtml);
  });
  logger.info({ staticDir }, "Serving frontend from STATIC_DIR");
}

// Express 5 forwards rejected async handlers here; without this the client gets
// an HTML page instead of {"error": ...} (e.g. DB down, multer file filter).
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status =
    typeof err?.status === "number" ? err.status : err?.name === "MulterError" ? 400 : 500;
  if (status >= 500) logger.error({ err, url: req.url }, "Unhandled request error");
  if (res.headersSent) return;
  const message = status < 500 && err instanceof Error ? err.message : "Внутренняя ошибка сервера";
  res.status(status).json({ error: message });
};
app.use(errorHandler);

export default app;
