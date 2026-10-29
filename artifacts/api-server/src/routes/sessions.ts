import { Router, type IRouter } from "express";
import { eq, count, inArray, and } from "drizzle-orm";
import { db, sessionsTable, segmentsTable, categoriesTable, directoriesTable } from "@workspace/db";
import {
  CreateSessionBody,
  GetSessionParams,
  DeleteSessionParams,
  ProcessSessionParams,
  UpdateSegmentParams,
  UpdateSegmentBody,
  ExportReportParams,
} from "@workspace/api-zod";
import { classifySegmentsBatch } from "../lib/aiClassifier";
import { parseBroadcastText } from "../lib/broadcastParser";
import { parseTranscript } from "../lib/transcriptParser";
import { segmentTranscript } from "../lib/transcriptSegmenter";
import { transcribeVideo, isYouTubeUrl, getYouTubeMetadata } from "../lib/videoTranscriber";
import { mergeVerstkaWithVideo, extractBroadcastDateFromUrl } from "../lib/mergeVerstkaWithVideo";
import { assertSafeVideoUrl } from "../lib/urlSafety";
import { generateExcel } from "../lib/excelGenerator";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

function timeToMinutes(time: string): number {
  const parts = time.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  return 0;
}

function durationMinutes(start: string, end: string): number {
  return Math.max(0, Math.round((timeToMinutes(end) - timeToMinutes(start)) * 100) / 100);
}

// Kazakh-specific Cyrillic letters absent from Russian. Used to drop the Kazakh
// duplicate of a bilingual справочник entry when classifying a Russian эфир.
const KAZAKH_LETTERS = /[әғқңөұүһі]/i;

/**
 * Bilingual справочники list each направление twice (Russian + Kazakh) under the
 * same code. Feeding both halves to the classifier doubles the candidates and
 * adds cross-language noise, which causes misses. Keep one variant per code,
 * preferring the Russian one (no Kazakh-specific letters in its title).
 */
function dedupeCategoriesByCode(
  categories: Array<{ id: number; code: string | null; title: string }>
): Array<{ id: number; code: string | null; title: string }> {
  const byCode = new Map<string, { id: number; code: string | null; title: string }>();
  const noCode: Array<{ id: number; code: string | null; title: string }> = [];
  for (const c of categories) {
    if (!c.code) {
      noCode.push(c);
      continue;
    }
    const existing = byCode.get(c.code);
    if (!existing) {
      byCode.set(c.code, c);
    } else if (KAZAKH_LETTERS.test(existing.title) && !KAZAKH_LETTERS.test(c.title)) {
      // Replace a Kazakh-titled entry with the Russian one for the same code.
      byCode.set(c.code, c);
    }
  }
  return [...byCode.values(), ...noCode];
}

/** Classify a session's segments against its directory using AI (idempotent; safe to re-run). */
async function classifySessionSegments(sessionId: number): Promise<void> {
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!session) return;

  let categories: Array<{ id: number; code: string | null; title: string }> = [];
  if (session.directoryId) {
    categories = await db
      .select()
      .from(categoriesTable)
      .where(eq(categoriesTable.directoryId, session.directoryId));
    categories = dedupeCategoriesByCode(categories);
  }

  const segments = await db.select().from(segmentsTable).where(eq(segmentsTable.sessionId, sessionId));

  if (segments.length > 0 && categories.length > 0) {
    const classResults = await classifySegmentsBatch(
      segments.map((s) => ({
        id: s.id,
        title: s.title,
        text: s.description ?? undefined,
      })),
      categories
    );
    for (const [segId, result] of classResults) {
      await db
        .update(segmentsTable)
        .set({
          categoryIds: result.categoryIds,
          aiSuggested: result.categoryIds.length > 0 ? 1 : 0,
        })
        .where(eq(segmentsTable.id, segId));
    }
  }
}

/**
 * Background job: download a video by URL, transcribe its audio to timecoded cues,
 * split it into key-event segments, classify them, and update the session status.
 * Runs detached from the HTTP request; progress is surfaced via session.status/progressMessage.
 */
// Never lets a DB write reject; progress updates are best-effort and log-only
// so a transient failure can't crash a detached background job.
function makeProgressUpdater(sessionId: number) {
  return async (status: string, progressMessage: string | null): Promise<void> => {
    try {
      await db
        .update(sessionsTable)
        .set({ status, progressMessage })
        .where(eq(sessionsTable.id, sessionId));
    } catch (err) {
      logger.error({ err, sessionId }, "Failed to update session progress");
    }
  };
}

async function processVideoSession(sessionId: number, videoUrl: string): Promise<void> {
  const setProgress = makeProgressUpdater(sessionId);

  try {
    const cues = await transcribeVideo(videoUrl, (msg) => {
      void setProgress("transcribing", msg);
    });
    if (cues.length === 0) {
      throw new Error("В видео не удалось распознать речь");
    }

    // Derive broadcast date (file name → YouTube upload date) and, for YouTube,
    // a program name from the video title when the user left the default.
    const ytMeta = isYouTubeUrl(videoUrl)
      ? await getYouTubeMetadata(videoUrl)
      : { uploadDate: null, title: null };
    const videoDate = extractBroadcastDateFromUrl(videoUrl) ?? ytMeta.uploadDate;
    const metaUpdates: { broadcastDate?: string; programName?: string } = {};
    if (videoDate) metaUpdates.broadcastDate = videoDate;
    if (ytMeta.title) {
      const [cur] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
      if (cur && cur.programName === "Без названия") metaUpdates.programName = ytMeta.title;
    }
    if (Object.keys(metaUpdates).length > 0) {
      await db.update(sessionsTable).set(metaUpdates).where(eq(sessionsTable.id, sessionId));
    }

    await setProgress("transcribing", "Разбивка эфира на сюжеты…");
    const segments = await segmentTranscript(cues);
    if (segments.length > 0) {
      await db.insert(segmentsTable).values(
        segments.map((s) => ({
          sessionId,
          title: s.title,
          speaker: s.speaker ?? null,
          timeStart: s.timeStart,
          timeEnd: s.timeEnd ?? s.timeStart,
          durationMinutes: durationMinutes(s.timeStart, s.timeEnd ?? s.timeStart),
          source: "video" as const,
          aiSuggested: 0,
          manuallyEdited: 0,
        }))
      );
    }

    await setProgress("processing", "Классификация сюжетов по справочнику…");
    await classifySessionSegments(sessionId);

    await setProgress("done", null);
  } catch (err) {
    logger.error({ err, sessionId }, "Video session processing failed");
    const message = err instanceof Error ? err.message : "Ошибка обработки видео";
    await setProgress("error", message);
  }
}

/**
 * Background job for the unified flow: transcribe the video, then merge the broadcast
 * script (вёрстка) with the transcript so that topics/speakers come from the вёрстка
 * while chronometry comes from the video. The broadcast date is taken from the video
 * file name and the program name is inferred by AI (unless the user supplied one).
 */
async function processUnifiedSession(
  sessionId: number,
  videoUrl: string,
  verstkaText: string,
  userProgramName: string | null,
  userBroadcastDate: string | null
): Promise<void> {
  const setProgress = makeProgressUpdater(sessionId);

  try {
    const cues = await transcribeVideo(videoUrl, (msg) => {
      void setProgress("transcribing", msg);
    });
    if (cues.length === 0) {
      throw new Error("В видео не удалось распознать речь");
    }

    await setProgress("transcribing", "Сопоставление вёрстки с видео…");
    const { programName: aiProgramName, segments } = await mergeVerstkaWithVideo(verstkaText, cues);

    // For a YouTube link there is no date in the file name — fall back to the
    // video's upload date / title from yt-dlp metadata.
    const ytMeta = isYouTubeUrl(videoUrl)
      ? await getYouTubeMetadata(videoUrl)
      : { uploadDate: null, title: null };

    // Date: from the video file name, else YouTube upload date, else user-entered.
    // Program name: user value > AI-derived > YouTube title > default.
    const videoDate = extractBroadcastDateFromUrl(videoUrl) ?? ytMeta.uploadDate;
    const finalProgramName = userProgramName ?? aiProgramName ?? ytMeta.title ?? "Без названия";
    const finalDate = videoDate ?? userBroadcastDate;

    const updates: { programName: string; broadcastDate?: string } = { programName: finalProgramName };
    if (finalDate) updates.broadcastDate = finalDate;
    await db.update(sessionsTable).set(updates).where(eq(sessionsTable.id, sessionId));

    if (segments.length > 0) {
      await db.insert(segmentsTable).values(
        segments.map((s) => ({
          sessionId,
          title: s.title,
          description: s.description ?? null,
          speaker: s.speaker ?? null,
          timeStart: s.timeStart,
          timeEnd: s.timeEnd,
          durationMinutes: durationMinutes(s.timeStart, s.timeEnd),
          source: "video" as const,
          aiSuggested: 0,
          manuallyEdited: 0,
        }))
      );
    }

    await setProgress("processing", "Классификация сюжетов по справочнику…");
    await classifySessionSegments(sessionId);

    await setProgress("done", null);
  } catch (err) {
    logger.error({ err, sessionId }, "Unified session processing failed");
    const message = err instanceof Error ? err.message : "Ошибка обработки видео";
    await setProgress("error", message);
  }
}

async function buildSessionDetail(sessionId: number) {
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!session) return null;

  const segments = await db
    .select()
    .from(segmentsTable)
    .where(eq(segmentsTable.sessionId, sessionId))
    .orderBy(segmentsTable.id);

  // Collect all referenced category ids and resolve their titles in one query
  const allCategoryIds = [...new Set(segments.flatMap((s) => s.categoryIds))];
  const categoryMap = new Map<number, { code: string | null; title: string }>();
  if (allCategoryIds.length > 0) {
    const cats = await db
      .select()
      .from(categoriesTable)
      .where(inArray(categoriesTable.id, allCategoryIds));
    for (const c of cats) categoryMap.set(c.id, { code: c.code ?? null, title: c.title });
  }

  const enrichedSegments = segments.map((seg) => {
    const categories = seg.categoryIds
      .filter((cid) => categoryMap.has(cid))
      .map((cid) => ({ id: cid, code: categoryMap.get(cid)!.code, title: categoryMap.get(cid)!.title }));
    return {
      id: seg.id,
      sessionId: seg.sessionId,
      title: seg.title,
      speaker: seg.speaker ?? null,
      timeStart: seg.timeStart,
      timeEnd: seg.timeEnd,
      durationMinutes: seg.durationMinutes,
      source: seg.source,
      categoryIds: categories.map((c) => c.id),
      categories,
      aiSuggested: seg.aiSuggested === 1,
      manuallyEdited: seg.manuallyEdited === 1,
    };
  });

  return {
    id: session.id,
    programName: session.programName,
    broadcastDate: session.broadcastDate,
    status: session.status,
    progressMessage: session.progressMessage ?? null,
    directoryId: session.directoryId ?? null,
    broadcastText: session.broadcastText ?? null,
    youtubeUrl: session.youtubeUrl ?? null,
    videoUrl: session.videoUrl ?? null,
    segments: enrichedSegments,
    createdAt: session.createdAt.toISOString(),
  };
}

router.get("/sessions", async (_req, res): Promise<void> => {
  const sessions = await db.select().from(sessionsTable).orderBy(sessionsTable.createdAt);

  // One grouped count instead of a query per session.
  const counts = await db
    .select({ sessionId: segmentsTable.sessionId, count: count() })
    .from(segmentsTable)
    .groupBy(segmentsTable.sessionId);
  const countBySession = new Map(counts.map((c) => [c.sessionId, Number(c.count)]));

  const result = sessions.map((s) => ({
    id: s.id,
    programName: s.programName,
    broadcastDate: s.broadcastDate,
    status: s.status,
    progressMessage: s.progressMessage ?? null,
    directoryId: s.directoryId ?? null,
    segmentsCount: countBySession.get(s.id) ?? 0,
    createdAt: s.createdAt.toISOString(),
  }));

  res.json(result);
});

router.post("/sessions", async (req, res): Promise<void> => {
  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { programName, broadcastDate, directoryId, broadcastText, youtubeUrl, transcriptText, videoUrl } =
    parsed.data;

  const trimmedVideoUrl = videoUrl?.trim() || null;
  const trimmedBroadcastText = broadcastText?.trim() || null;
  // programName and broadcastDate are optional: in the unified flow the AI/video supply
  // them. Keep user-entered values when present, otherwise fill safe defaults at insert.
  const userProgramName = programName?.trim() || null;
  const userBroadcastDate = broadcastDate?.trim() || null;
  if (trimmedVideoUrl) {
    try {
      await assertSafeVideoUrl(trimmedVideoUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Недопустимая ссылка на видео";
      res.status(400).json({ error: message });
      return;
    }
  }

  // Parse the transcript up-front so a malformed/timecode-less paste fails loudly
  // (400) instead of silently producing an empty session.
  let transcriptCues: ReturnType<typeof parseTranscript> | null = null;
  if (transcriptText && transcriptText.trim()) {
    try {
      transcriptCues = parseTranscript(transcriptText);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось разобрать субтитры";
      res.status(400).json({ error: message });
      return;
    }
  }

  const [session] = await db
    .insert(sessionsTable)
    .values({
      programName: userProgramName ?? "Без названия",
      broadcastDate: userBroadcastDate ?? new Date().toISOString().slice(0, 10),
      directoryId: directoryId ?? null,
      broadcastText: trimmedBroadcastText,
      youtubeUrl: youtubeUrl ?? null,
      videoUrl: trimmedVideoUrl,
      status: trimmedVideoUrl ? "transcribing" : "draft",
      progressMessage: trimmedVideoUrl ? "Постановка задачи в очередь…" : null,
    })
    .returning();

  // Unified flow: вёрстка + video together. Topics/speakers come from the вёрстка,
  // chronometry/date from the video. Runs in the background so the client can poll.
  if (trimmedVideoUrl && trimmedBroadcastText) {
    processUnifiedSession(
      session.id,
      trimmedVideoUrl,
      trimmedBroadcastText,
      userProgramName,
      userBroadcastDate
    ).catch((err) => {
      logger.error({ err, sessionId: session.id }, "Unhandled error in unified session processing");
    });
    res.status(201).json({
      id: session.id,
      programName: session.programName,
      broadcastDate: session.broadcastDate,
      status: session.status,
      progressMessage: session.progressMessage ?? null,
      directoryId: session.directoryId ?? null,
      segmentsCount: 0,
      createdAt: session.createdAt.toISOString(),
    });
    return;
  }

  // Direct video link only: download + transcribe + segment + classify in the background,
  // returning immediately so the client can poll session status for progress.
  if (trimmedVideoUrl) {
    processVideoSession(session.id, trimmedVideoUrl).catch((err) => {
      logger.error({ err, sessionId: session.id }, "Unhandled error in video session processing");
    });
    res.status(201).json({
      id: session.id,
      programName: session.programName,
      broadcastDate: session.broadcastDate,
      status: session.status,
      progressMessage: session.progressMessage ?? null,
      directoryId: session.directoryId ?? null,
      segmentsCount: 0,
      createdAt: session.createdAt.toISOString(),
    });
    return;
  }

  // Parse broadcast text into segments immediately
  if (broadcastText) {
    const rawSegments = parseBroadcastText(broadcastText);
    if (rawSegments.length > 0) {
      await db.insert(segmentsTable).values(
        rawSegments.map((s) => ({
          sessionId: session.id,
          title: s.title,
          speaker: s.speaker ?? null,
          timeStart: s.timeStart,
          timeEnd: s.timeEnd,
          durationMinutes: s.durationMinutes,
          source: "broadcast" as const,
          aiSuggested: 0,
          manuallyEdited: 0,
        }))
      );
    }
  }

  // Let AI split the parsed transcript into key-event segments with timecodes
  if (transcriptCues) {
    const ytSegments = await segmentTranscript(transcriptCues);
    if (ytSegments.length > 0) {
      await db.insert(segmentsTable).values(
        ytSegments.map((s) => ({
          sessionId: session.id,
          title: s.title,
          speaker: s.speaker ?? null,
          timeStart: s.timeStart,
          timeEnd: s.timeEnd ?? s.timeStart,
          durationMinutes: durationMinutes(s.timeStart, s.timeEnd ?? s.timeStart),
          source: "youtube" as const,
          aiSuggested: 0,
          manuallyEdited: 0,
        }))
      );
    }
  }

  res.status(201).json({
    id: session.id,
    programName: session.programName,
    broadcastDate: session.broadcastDate,
    status: session.status,
    directoryId: session.directoryId ?? null,
    segmentsCount: 0,
    createdAt: session.createdAt.toISOString(),
  });
});

router.get("/sessions/:id", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const detail = await buildSessionDetail(params.data.id);
  if (!detail) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json(detail);
});

router.delete("/sessions/:id", async (req, res): Promise<void> => {
  const params = DeleteSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db.delete(segmentsTable).where(eq(segmentsTable.sessionId, params.data.id));
  await db.delete(sessionsTable).where(eq(sessionsTable.id, params.data.id));

  res.sendStatus(204);
});

router.post("/sessions/:id/process", async (req, res): Promise<void> => {
  const params = ProcessSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, params.data.id));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  // A background video job owns the session until it finishes; re-classifying
  // now would flip it to "done" while segments are still being inserted.
  if (session.status === "transcribing" || session.status === "processing") {
    res.status(409).json({ error: "Сессия ещё обрабатывается, дождитесь завершения" });
    return;
  }

  await db
    .update(sessionsTable)
    .set({ status: "processing", progressMessage: null })
    .where(eq(sessionsTable.id, session.id));

  try {
    await classifySessionSegments(session.id);
    await db.update(sessionsTable).set({ status: "done" }).where(eq(sessionsTable.id, session.id));
  } catch (err) {
    logger.error({ err }, "Processing failed");
    await db.update(sessionsTable).set({ status: "draft" }).where(eq(sessionsTable.id, session.id));
  }

  const detail = await buildSessionDetail(params.data.id);
  res.json(detail);
});

router.patch("/sessions/:id/segments/:segmentId", async (req, res): Promise<void> => {
  const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const segIdRaw = Array.isArray(req.params.segmentId) ? req.params.segmentId[0] : req.params.segmentId;
  const id = parseInt(idRaw, 10);
  const segmentId = parseInt(segIdRaw, 10);

  const params = UpdateSegmentParams.safeParse({ id, segmentId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateSegmentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  // Ensure the session exists and the segment belongs to it
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, params.data.id));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const [existing] = await db.select().from(segmentsTable).where(eq(segmentsTable.id, params.data.segmentId));
  if (!existing || existing.sessionId !== params.data.id) {
    res.status(404).json({ error: "Segment not found" });
    return;
  }

  const updates: Record<string, unknown> = { manuallyEdited: 1 };
  if (body.data.categoryIds !== undefined) {
    const requestedIds = [...new Set(body.data.categoryIds ?? [])];
    if (requestedIds.length > 0) {
      // Category IDs must belong to the session's directory (строго из справочника)
      if (!session.directoryId) {
        res.status(400).json({ error: "Session has no directory; cannot assign categories" });
        return;
      }
      const validCats = await db
        .select({ id: categoriesTable.id })
        .from(categoriesTable)
        .where(
          and(
            eq(categoriesTable.directoryId, session.directoryId),
            inArray(categoriesTable.id, requestedIds)
          )
        );
      const validIds = new Set(validCats.map((c) => c.id));
      const invalid = requestedIds.filter((cid) => !validIds.has(cid));
      if (invalid.length > 0) {
        res.status(400).json({ error: `Категории не принадлежат справочнику сессии: ${invalid.join(", ")}` });
        return;
      }
    }
    updates.categoryIds = requestedIds;
  }
  if (body.data.title !== undefined) updates.title = body.data.title ?? undefined;
  if (body.data.speaker !== undefined) updates.speaker = body.data.speaker ?? null;

  const [updated] = await db
    .update(segmentsTable)
    .set(updates)
    .where(eq(segmentsTable.id, params.data.segmentId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Segment not found" });
    return;
  }

  const categoryTitleMap = new Map<number, string>();
  if (updated.categoryIds.length > 0) {
    const cats = await db
      .select()
      .from(categoriesTable)
      .where(inArray(categoriesTable.id, updated.categoryIds));
    for (const c of cats) categoryTitleMap.set(c.id, c.title);
  }
  const categories = updated.categoryIds
    .filter((cid) => categoryTitleMap.has(cid))
    .map((cid) => ({ id: cid, title: categoryTitleMap.get(cid)! }));

  res.json({
    id: updated.id,
    sessionId: updated.sessionId,
    title: updated.title,
    speaker: updated.speaker ?? null,
    timeStart: updated.timeStart,
    timeEnd: updated.timeEnd,
    durationMinutes: updated.durationMinutes,
    source: updated.source,
    categoryIds: categories.map((c) => c.id),
    categories,
    aiSuggested: updated.aiSuggested === 1,
    manuallyEdited: updated.manuallyEdited === 1,
  });
});

router.get("/sessions/:id/export", async (req, res): Promise<void> => {
  const params = ExportReportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const detail = await buildSessionDetail(params.data.id);
  if (!detail) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const { buffer, filename } = await generateExcel(detail);
  const base64 = buffer.toString("base64");

  res.json({ filename, base64 });
});

export default router;
