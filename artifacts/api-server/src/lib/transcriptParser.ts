export interface TranscriptCue {
  /** Start time in seconds */
  start: number;
  /** End time in seconds */
  end: number;
  text: string;
}

/** Convert a timecode string to seconds. Supports HH:MM:SS(.mmm), MM:SS(.mmm), with "," or "." for milliseconds. */
function timecodeToSeconds(raw: string): number | null {
  const cleaned = raw.trim().replace(",", ".");
  const m = cleaned.match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const [, hh, mm, ss, ms] = m;
  const hours = hh ? parseInt(hh, 10) : 0;
  const minutes = parseInt(mm, 10);
  const seconds = parseInt(ss, 10);
  const millis = ms ? parseInt(ms.padEnd(3, "0"), 10) : 0;
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

/** Format seconds as HH:MM:SS */
export function secondsToHHMMSS(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** Strip inline VTT/SRT formatting tags like <c>, <00:00:01.000>, {\an8} */
function stripCueTags(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/\{[^}]+\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse SRT or WebVTT content (blocks separated by blank lines, each with a "start --> end" line). */
function parseCueBlocks(raw: string): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  const blocks = raw.replace(/\r\n/g, "\n").split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim());
    const timeLineIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeLineIdx === -1) continue;

    const timeLine = lines[timeLineIdx];
    const tm = timeLine.match(
      /((?:\d{1,3}:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d{1,3}:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)/
    );
    if (!tm) continue;
    const start = timecodeToSeconds(tm[1]);
    const end = timecodeToSeconds(tm[2]);
    if (start === null || end === null) continue;

    const text = stripCueTags(lines.slice(timeLineIdx + 1).join(" "));
    if (!text) continue;

    cues.push({ start, end: Math.max(end, start), text });
  }

  return cues;
}

/** Parse a plain transcript where each cue is prefixed by a timecode (e.g. YouTube "Показать расшифровку" copy). */
function parsePlainTimecoded(raw: string): TranscriptCue[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const leadingTc = /^\s*((?:\d{1,3}:)?\d{1,2}:\d{2})\b[)\].:-]?\s*(.*)$/;

  type Tmp = { start: number; text: string };
  const tmp: Tmp[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(leadingTc);
    if (!m) continue;
    const start = timecodeToSeconds(m[1]);
    if (start === null) continue;

    let text = m[2].trim();
    // YouTube transcript copies often put the timecode on its own line, text on the next line(s).
    if (!text) {
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (leadingTc.test(next)) break;
        const t = next.trim();
        if (t) text += (text ? " " : "") + t;
      }
    }
    text = stripCueTags(text);
    if (text) tmp.push({ start, text });
  }

  // Derive end times from the next cue's start.
  const cues: TranscriptCue[] = tmp.map((c, idx) => {
    const next = tmp[idx + 1];
    const end = next ? next.start : c.start + 5;
    return { start: c.start, end: Math.max(end, c.start), text: c.text };
  });

  return cues;
}

/**
 * Parse subtitles / transcript text into timed cues.
 * Auto-detects SRT, WebVTT, or plain timecoded transcript.
 * Returns cues sorted by start time. Throws if no timecodes can be found.
 */
export function parseTranscript(raw: string): TranscriptCue[] {
  const text = raw.trim();
  if (!text) {
    throw new Error("Пустой текст субтитров");
  }

  let cues: TranscriptCue[];
  if (text.includes("-->")) {
    cues = parseCueBlocks(text);
  } else {
    cues = parsePlainTimecoded(text);
  }

  cues = cues.filter((c) => c.text.length > 0).sort((a, b) => a.start - b.start);

  if (cues.length === 0) {
    throw new Error(
      "Не удалось найти таймкоды в субтитрах. Поддерживаются форматы SRT, WebVTT (.vtt) и расшифровка с таймкодами (0:00 текст)."
    );
  }

  return cues;
}
