import { openai, MODELS } from "./openai";
import { logger } from "./logger";
import { type TranscriptCue, secondsToHHMMSS } from "./transcriptParser";

export interface TranscriptSegment {
  title: string;
  timeStart: string;
  timeEnd: string;
  speaker: string | null;
}

/** Merge consecutive cues into compact timecoded lines to keep the prompt small. */
function buildTimecodedLines(cues: TranscriptCue[], maxLineChars = 140): Array<{ start: number; text: string }> {
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

/** Split lines into chunks that stay under a character budget for the model. */
function chunkLines(
  lines: Array<{ start: number; text: string }>,
  maxChunkChars = 24000
): Array<Array<{ start: number; text: string }>> {
  const chunks: Array<Array<{ start: number; text: string }>> = [];
  let chunk: Array<{ start: number; text: string }> = [];
  let size = 0;

  for (const line of lines) {
    const lineSize = line.text.length + 12;
    if (size + lineSize > maxChunkChars && chunk.length > 0) {
      chunks.push(chunk);
      chunk = [];
      size = 0;
    }
    chunk.push(line);
    size += lineSize;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

function hhmmssToSeconds(t: string): number {
  const parts = t.split(":").map((p) => parseInt(p, 10));
  if (parts.length === 3 && parts.every((n) => !isNaN(n))) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2 && parts.every((n) => !isNaN(n))) return parts[0] * 60 + parts[1];
  return NaN;
}

/**
 * Enforce a clean, monotonic timeline across all collected segments:
 * drop invalid entries, sort by start time, guarantee timeEnd >= timeStart,
 * and trim any overlap so a segment never runs past the next one's start.
 */
function normalizeSegments(segments: TranscriptSegment[], globalMax: number): TranscriptSegment[] {
  const arr = segments
    .map((s) => ({ seg: s, start: hhmmssToSeconds(s.timeStart), end: hhmmssToSeconds(s.timeEnd) }))
    .filter((x) => !isNaN(x.start))
    .map((x) => ({ ...x, end: isNaN(x.end) || x.end < x.start ? x.start : x.end }))
    .sort((a, b) => a.start - b.start);

  for (let i = 0; i < arr.length; i++) {
    const next = arr[i + 1];
    if (next && next.start < arr[i].end) {
      arr[i].end = next.start; // trim overlap into the next segment
    } else if (!next) {
      arr[i].end = Math.max(arr[i].start, Math.min(arr[i].end, globalMax)); // cap last segment at the transcript end
    }
  }

  return arr.map((x) => ({
    title: x.seg.title,
    timeStart: secondsToHHMMSS(x.start),
    timeEnd: secondsToHHMMSS(x.end),
    speaker: x.seg.speaker,
  }));
}

function normalizeTimecode(raw: unknown, minSec: number, maxSec: number): string {
  if (typeof raw !== "string") return secondsToHHMMSS(minSec);
  const parts = raw.trim().split(":").map((p) => parseInt(p, 10));
  let sec = 0;
  if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
    sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2 && parts.every((n) => !isNaN(n))) {
    sec = parts[0] * 60 + parts[1];
  } else {
    sec = minSec;
  }
  // Clamp into the transcript's real range so the model can't invent out-of-range timecodes.
  sec = Math.min(Math.max(sec, minSec), maxSec);
  return secondsToHHMMSS(sec);
}

async function segmentChunk(
  lines: Array<{ start: number; text: string }>,
  partInfo: { index: number; total: number },
  rangeMin: number,
  rangeMax: number
): Promise<TranscriptSegment[]> {
  const transcript = lines.map((l) => `[${secondsToHHMMSS(l.start)}] ${l.text}`).join("\n");

  const partNote =
    partInfo.total > 1
      ? `\n\nЭто часть ${partInfo.index} из ${partInfo.total} полной расшифровки эфира. Раздели на сюжеты только эту часть.`
      : "";

  const prompt = `Ты — опытный редактор новостей телеканала. Ниже приведена расшифровка эфира с таймкодами (формат [ЧЧ:ММ:СС]).

Твоя задача — разделить эфир на отдельные СЮЖЕТЫ (ключевые события, новости, темы). Для каждого сюжета определи:
- "title": краткая ключевая мысль сюжета на русском языке (одно ёмкое предложение, без таймкодов).
- "timeStart": таймкод начала сюжета (бери из расшифровки, формат ЧЧ:ММ:СС).
- "timeEnd": таймкод конца сюжета (начало следующего сюжета или конец фрагмента).
- "speaker": имя спикера/корреспондента, если он явно назван в тексте, иначе null.

ПРАВИЛА:
- Сюжеты должны идти подряд, без пропусков и пересечений по времени.
- Каждый значимый информационный блок — отдельный сюжет. Не объединяй разные новости в один сюжет.
- Не придумывай содержание, опирайся только на текст расшифровки.
- Таймкоды должны быть в диапазоне от ${secondsToHHMMSS(rangeMin)} до ${secondsToHHMMSS(rangeMax)}.${partNote}

РАСШИФРОВКА:
${transcript}

Ответь СТРОГО в формате JSON без пояснений: {"segments": [{"title": "...", "timeStart": "ЧЧ:ММ:СС", "timeEnd": "ЧЧ:ММ:СС", "speaker": "..." | null}]}.`;

  const response = await openai.chat.completions.create({
    model: MODELS.mini,
    max_tokens: 4000,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.choices[0]?.message?.content?.trim() ?? "{}";
  let parsed: { segments?: unknown };
  try {
    parsed = JSON.parse(content) as { segments?: unknown };
  } catch {
    return [];
  }

  if (!Array.isArray(parsed.segments)) return [];

  const segments: TranscriptSegment[] = [];
  for (const raw of parsed.segments) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    if (!title) continue;
    const timeStart = normalizeTimecode(obj.timeStart, rangeMin, rangeMax);
    const timeEnd = normalizeTimecode(obj.timeEnd, rangeMin, rangeMax);
    const speaker =
      typeof obj.speaker === "string" && obj.speaker.trim() && obj.speaker.trim().toLowerCase() !== "null"
        ? obj.speaker.trim()
        : null;
    segments.push({ title, timeStart, timeEnd, speaker });
  }

  return segments;
}

/** Group cues into fixed-duration windows as a deterministic fallback when AI segmentation is unavailable. */
function fallbackWindows(cues: TranscriptCue[], windowSeconds = 180): TranscriptSegment[] {
  if (cues.length === 0) return [];
  const segments: TranscriptSegment[] = [];
  const start = cues[0].start;
  const end = cues[cues.length - 1].end;

  for (let winStart = start; winStart < end; winStart += windowSeconds) {
    const winEnd = Math.min(winStart + windowSeconds, end);
    const inWindow = cues.filter((c) => c.start >= winStart && c.start < winEnd);
    if (inWindow.length === 0) continue;
    const text = inWindow.map((c) => c.text).join(" ");
    segments.push({
      title: text.slice(0, 160).trim() || "Фрагмент эфира",
      timeStart: secondsToHHMMSS(winStart),
      timeEnd: secondsToHHMMSS(winEnd),
      speaker: null,
    });
  }

  return segments;
}

/**
 * Analyze a full transcript and split it into key-event segments ("сюжеты") with timecodes.
 * Uses GPT-4o-mini; falls back to fixed time windows if the model returns nothing or errors.
 */
export async function segmentTranscript(cues: TranscriptCue[]): Promise<TranscriptSegment[]> {
  if (cues.length === 0) return [];

  const rangeMin = cues[0].start;
  const rangeMax = cues[cues.length - 1].end;
  const lines = buildTimecodedLines(cues);
  const chunks = chunkLines(lines);

  try {
    const all: TranscriptSegment[] = [];
    for (let i = 0; i < chunks.length; i++) {
      // Clamp each chunk's timecodes to its own span (start of this chunk →
      // start of the next chunk, or the global end for the last chunk) so the
      // model can't bleed timecodes across chunk boundaries.
      const chunkMin = chunks[i][0].start;
      const chunkMax = i + 1 < chunks.length ? chunks[i + 1][0].start : rangeMax;
      const segs = await segmentChunk(chunks[i], { index: i + 1, total: chunks.length }, chunkMin, chunkMax);
      all.push(...segs);
    }

    const cleaned = normalizeSegments(
      all.filter((s) => s.title.length > 0),
      rangeMax
    );

    if (cleaned.length > 0) return cleaned;

    logger.warn("AI segmentation returned no segments, using fallback windows");
    return fallbackWindows(cues);
  } catch (err) {
    logger.error({ err }, "AI transcript segmentation failed, using fallback windows");
    return fallbackWindows(cues);
  }
}
