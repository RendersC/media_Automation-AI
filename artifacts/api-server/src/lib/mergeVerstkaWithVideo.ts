import { openai, MODELS } from "./openai";
import { logger } from "./logger";
import { type TranscriptCue, secondsToHHMMSS } from "./transcriptParser";
import { parseBroadcastText } from "./broadcastParser";

export interface MergedSegment {
  title: string;
  /** Ключевая мысль/суть сюжета из вёрстки — даёт контекст ИИ-классификатору. */
  description: string | null;
  timeStart: string;
  timeEnd: string;
  speaker: string | null;
}

export interface MergeResult {
  programName: string | null;
  segments: MergedSegment[];
}

/** Merge consecutive cues into compact timecoded lines to keep the prompt small. */
function buildTimecodedLines(cues: TranscriptCue[], maxLineChars = 160): Array<{ start: number; text: string }> {
  const lines: Array<{ start: number; text: string }> = [];
  let current: { start: number; text: string } | null = null;

  for (const cue of cues) {
    if (current && current.text.length + cue.text.length + 1 <= maxLineChars) {
      current.text += " " + cue.text;
    } else {
      if (current) lines.push(current);
      current = { start: cue.start, text: cue.text };
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Keep the timecoded transcript under a character budget so the single merge call
 * stays within the model's context window for long broadcasts. Drops lines uniformly
 * (preserving timecode spread) rather than truncating the tail.
 */
function fitToBudget(
  lines: Array<{ start: number; text: string }>,
  maxChars = 60000
): Array<{ start: number; text: string }> {
  const total = lines.reduce((acc, l) => acc + l.text.length + 14, 0);
  if (total <= maxChars || lines.length <= 1) return lines;
  const step = Math.ceil(total / maxChars);
  const kept = lines.filter((_, i) => i % step === 0);
  // Always keep the final line so the model knows the true end of the broadcast.
  if (kept[kept.length - 1] !== lines[lines.length - 1]) kept.push(lines[lines.length - 1]);
  return kept;
}

/**
 * Deterministic fallback when the AI merge is unavailable or returns nothing:
 * take the topics straight from the вёрстка and spread them evenly across the
 * video's real time span so chronometry still derives from the video duration.
 */
function fallbackMerge(verstkaText: string, rangeMin: number, rangeMax: number): MergedSegment[] {
  const topics = parseBroadcastText(verstkaText);
  if (topics.length === 0) return [];
  const span = Math.max(0, rangeMax - rangeMin);
  const per = topics.length > 0 ? span / topics.length : span;
  return topics.map((t, i) => {
    const start = rangeMin + per * i;
    const end = i === topics.length - 1 ? rangeMax : rangeMin + per * (i + 1);
    return {
      title: t.title,
      description: null,
      speaker: t.speaker,
      timeStart: secondsToHHMMSS(start),
      timeEnd: secondsToHHMMSS(end),
    };
  });
}

/**
 * Spread segments evenly across the real video span while preserving order,
 * titles, descriptions and speakers. Used as a safety net when the model's
 * timecodes collapse (many identical starts → zero-duration segments).
 */
function evenSpread(segments: MergedSegment[], rangeMin: number, rangeMax: number): MergedSegment[] {
  const n = segments.length;
  if (n === 0) return segments;
  const span = Math.max(0, rangeMax - rangeMin);
  const per = span / n;
  return segments.map((s, i) => ({
    ...s,
    timeStart: secondsToHHMMSS(rangeMin + per * i),
    timeEnd: secondsToHHMMSS(i === n - 1 ? rangeMax : rangeMin + per * (i + 1)),
  }));
}

/**
 * Detect a degenerate timeline: the model failed to align topics to the
 * transcript and clustered most of them at a single timecode, leaving lots of
 * zero-duration сюжеты. We treat it as degenerate when fewer than ~60% of the
 * segments have a distinct start time.
 */
function isDegenerateTimeline(segments: MergedSegment[]): boolean {
  if (segments.length <= 2) return false;
  const uniqueStarts = new Set(segments.map((s) => s.timeStart)).size;
  return uniqueStarts < Math.ceil(segments.length * 0.6);
}

function clampToHHMMSS(raw: unknown, minSec: number, maxSec: number, fallbackSec: number): string {
  if (typeof raw !== "string") return secondsToHHMMSS(fallbackSec);
  const parts = raw.trim().split(":").map((p) => parseInt(p, 10));
  let sec: number;
  if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
    sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2 && parts.every((n) => !isNaN(n))) {
    sec = parts[0] * 60 + parts[1];
  } else {
    sec = fallbackSec;
  }
  sec = Math.min(Math.max(sec, minSec), maxSec);
  return secondsToHHMMSS(sec);
}

function hhmmssToSeconds(t: string): number {
  const parts = t.split(":").map((p) => parseInt(p, 10));
  if (parts.length === 3 && parts.every((n) => !isNaN(n))) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2 && parts.every((n) => !isNaN(n))) return parts[0] * 60 + parts[1];
  return NaN;
}

/**
 * Enforce a clean, monotonic timeline: sort by start, fill missing/inverted ends
 * with the next segment's start (or the transcript end for the last one).
 */
function normalize(segments: MergedSegment[], globalMin: number, globalMax: number): MergedSegment[] {
  const arr = segments
    .map((s) => ({ seg: s, start: hhmmssToSeconds(s.timeStart), end: hhmmssToSeconds(s.timeEnd) }))
    .filter((x) => !isNaN(x.start))
    .sort((a, b) => a.start - b.start);

  for (let i = 0; i < arr.length; i++) {
    const next = arr[i + 1];
    if (next) {
      // End each segment where the next one starts so chronometry covers the whole video.
      arr[i].end = next.start > arr[i].start ? next.start : arr[i].start;
    } else {
      arr[i].end =
        !isNaN(arr[i].end) && arr[i].end > arr[i].start ? Math.min(arr[i].end, globalMax) : globalMax;
    }
  }

  return arr.map((x) => ({
    title: x.seg.title,
    description: x.seg.description,
    timeStart: secondsToHHMMSS(Math.max(x.start, globalMin)),
    timeEnd: secondsToHHMMSS(x.end),
    speaker: x.seg.speaker,
  }));
}

/**
 * Unified analysis for the combined flow: takes the broadcast script (вёрстка) and the
 * video transcript (with timecodes) and produces the final сюжет list where:
 *  - title (тема передачи) and speaker come from the вёрстка,
 *  - timeStart/timeEnd come from where that тема is discussed in the video transcript,
 *  - programName is inferred from the вёрстка + the video content.
 *
 * One GPT-4o-mini call does extraction + alignment together so the topics stay coherent
 * with the actual airing order.
 */
export async function mergeVerstkaWithVideo(
  verstkaText: string,
  cues: TranscriptCue[]
): Promise<MergeResult> {
  if (cues.length === 0) return { programName: null, segments: [] };

  const rangeMin = cues[0].start;
  const rangeMax = cues[cues.length - 1].end;
  const lines = fitToBudget(buildTimecodedLines(cues));
  const transcript = lines.map((l) => `[${secondsToHHMMSS(l.start)}] ${l.text}`).join("\n");

  const prompt = `Ты — опытный редактор новостей телеканала. У тебя есть ВЁРСТКА эфира (сценарий со списком сюжетов) и РАСШИФРОВКА самого видео с таймкодами (формат [ЧЧ:ММ:СС]).

Твоя задача — собрать итоговый список СЮЖЕТОВ эфира. Для каждого сюжета определи:
- "title": краткое название сюжета из ВЁРСТКИ (геотитр/тема, 1–5 слов, например «Амнистия», «Токаев-Кипр»).
- "description": ключевая мысль/суть сюжета 1–3 предложениями ИЗ ВЁРСТКИ (о чём сюжет, кто и что сделал/заявил). Передай содержание как можно полнее — оно нужно для тематической классификации. Если в вёрстке только заголовок — повтори его.
- "speaker": имя спикера/корреспондента (автора) из ВЁРСТКИ, если указан, иначе null.
- "timeStart": таймкод начала сюжета — где эта тема звучит В РАСШИФРОВКЕ ВИДЕО (формат ЧЧ:ММ:СС, бери из расшифровки).
- "timeEnd": таймкод конца сюжета (начало следующего сюжета).

Также определи "programName" — название программы/эфира, опираясь на вёрстку и содержание видео (например «Новости», «Информбюро»). Если определить нельзя — null.

ПРАВИЛА:
- Список сюжетов и их порядок бери из ВЁРСТКИ. Темы и описания формулируй по вёрстке, а не по расшифровке.
- ОБЯЗАТЕЛЬНО найди для КАЖДОГО сюжета свой таймкод в РАСШИФРОВКЕ ВИДЕО: определи, где в видео начинается обсуждение этой темы. Сюжеты идут подряд по времени и НЕ должны иметь одинаковый timeStart — у каждого свой момент начала, распредели их по всей длительности эфира.
- Таймкоды строго в диапазоне от ${secondsToHHMMSS(rangeMin)} до ${secondsToHHMMSS(rangeMax)}.
- Не придумывай сюжеты, которых нет в вёрстке.

ВЁРСТКА:
${verstkaText}

РАСШИФРОВКА ВИДЕО:
${transcript}

Ответь СТРОГО в формате JSON без пояснений: {"programName": "..." | null, "segments": [{"title": "...", "description": "...", "speaker": "..." | null, "timeStart": "ЧЧ:ММ:СС", "timeEnd": "ЧЧ:ММ:СС"}]}.`;

  let content = "{}";
  try {
    const response = await openai.chat.completions.create({
      model: MODELS.main,
      max_tokens: 6000,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    });
    content = response.choices[0]?.message?.content?.trim() ?? "{}";
  } catch (err) {
    logger.warn({ err }, "mergeVerstkaWithVideo: AI merge failed, using вёрстка fallback");
    return { programName: null, segments: fallbackMerge(verstkaText, rangeMin, rangeMax) };
  }

  let parsed: { programName?: unknown; segments?: unknown };
  try {
    parsed = JSON.parse(content) as { programName?: unknown; segments?: unknown };
  } catch {
    logger.warn("mergeVerstkaWithVideo: failed to parse model JSON, using вёрстка fallback");
    return { programName: null, segments: fallbackMerge(verstkaText, rangeMin, rangeMax) };
  }

  const programName =
    typeof parsed.programName === "string" &&
    parsed.programName.trim() &&
    parsed.programName.trim().toLowerCase() !== "null"
      ? parsed.programName.trim()
      : null;

  if (!Array.isArray(parsed.segments)) {
    return { programName, segments: fallbackMerge(verstkaText, rangeMin, rangeMax) };
  }

  const raw: MergedSegment[] = [];
  for (const item of parsed.segments) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    if (!title) continue;
    const description =
      typeof obj.description === "string" &&
      obj.description.trim() &&
      obj.description.trim().toLowerCase() !== "null"
        ? obj.description.trim()
        : null;
    const timeStart = clampToHHMMSS(obj.timeStart, rangeMin, rangeMax, rangeMin);
    const timeEnd = clampToHHMMSS(obj.timeEnd, rangeMin, rangeMax, rangeMax);
    const speaker =
      typeof obj.speaker === "string" && obj.speaker.trim() && obj.speaker.trim().toLowerCase() !== "null"
        ? obj.speaker.trim()
        : null;
    raw.push({ title, description, timeStart, timeEnd, speaker });
  }

  if (raw.length === 0) {
    return { programName, segments: fallbackMerge(verstkaText, rangeMin, rangeMax) };
  }

  const merged = normalize(raw, rangeMin, rangeMax);
  // Safety net: if the model collapsed most сюжеты onto one timecode (zero-duration),
  // spread them evenly across the real video span so chronometry stays meaningful.
  if (isDegenerateTimeline(merged)) {
    logger.warn(
      { segments: merged.length, uniqueStarts: new Set(merged.map((s) => s.timeStart)).size },
      "mergeVerstkaWithVideo: degenerate timeline from model, applying even spread"
    );
    return { programName, segments: evenSpread(merged, rangeMin, rangeMax) };
  }

  return { programName, segments: merged };
}

/**
 * Extract the broadcast date from a video file URL.
 *
 * Handles the common channel naming convention `DD-MM-YY` in the file name
 * (e.g. `04-06-26-EFIR-RUS-DEN.mp4` → 2026-06-04) and falls back to a
 * `/YYYY/MM/DD/` style path. Returns an ISO `YYYY-MM-DD` string or null.
 */
export function extractBroadcastDateFromUrl(url: string): string | null {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // keep raw string if it isn't a full URL
  }

  const fileName = pathname.split("/").pop() ?? pathname;

  // DD-MM-YY or DD-MM-YYYY in the file name, anchored so it isn't matched
  // inside a longer run of digits.
  const dmy = fileName.match(/(?:^|[^\d])(\d{2})[-_.](\d{2})[-_.](\d{2,4})(?![\d])/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10);
    let year = parseInt(dmy[3], 10);
    if (year < 100) year += 2000;
    if (isValidYmd(year, month, day)) {
      return toIso(year, month, day);
    }
  }

  // /YYYY/MM/DD/ style path.
  const ymdPath = pathname.match(/(?:^|[^\d])(\d{4})[\/](\d{2})[\/](\d{2})(?![\d])/);
  if (ymdPath) {
    const year = parseInt(ymdPath[1], 10);
    const month = parseInt(ymdPath[2], 10);
    const day = parseInt(ymdPath[3], 10);
    if (isValidYmd(year, month, day)) {
      return toIso(year, month, day);
    }
  }

  return null;
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  // Reject impossible calendar dates (e.g. 31-02) via round-trip construction.
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
