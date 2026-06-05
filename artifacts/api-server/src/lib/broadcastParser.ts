interface ParsedSegment {
  title: string;
  speaker: string | null;
  timeStart: string;
  timeEnd: string;
  durationMinutes: number;
}

function timeToMinutes(time: string): number {
  const parts = time.split(":").map(Number);
  if (parts.length === 3) {
    return parts[0] * 60 + parts[1] + parts[2] / 60;
  }
  if (parts.length === 2) {
    return parts[0] + parts[1] / 60;
  }
  return 0;
}

function calcDuration(start: string, end: string): number {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  return Math.max(0, Math.round((e - s) * 100) / 100);
}

/**
 * Parses a Russian broadcast script text and extracts segments with timecodes.
 *
 * Handles formats like:
 * - "00:00 - 05:30 | Название сюжета"
 * - "05:30-10:00 Тема передачи. Спикер: Иванов"
 * - Lines containing time patterns followed by text
 */
export function parseBroadcastText(text: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  const lines = text.split("\n");

  // Pattern 1: HH:MM:SS - HH:MM:SS or HH:MM - HH:MM with optional separator
  const timeRangePattern = /(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—|]\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[|:]?\s*(.+)/;

  // Pattern 2: Just a start time with title on same line: "05:30 Название"
  const singleTimePattern = /^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)/;

  let lastEndTime: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const rangeMatch = line.match(timeRangePattern);
    if (rangeMatch) {
      const [, timeStart, timeEnd, rest] = rangeMatch;
      const { title, speaker } = extractTitleAndSpeaker(rest);
      segments.push({
        title,
        speaker,
        timeStart: normalizeTime(timeStart),
        timeEnd: normalizeTime(timeEnd),
        durationMinutes: calcDuration(timeStart, timeEnd),
      });
      lastEndTime = normalizeTime(timeEnd);
      continue;
    }

    const singleMatch = line.match(singleTimePattern);
    if (singleMatch) {
      const [, timeStart, rest] = singleMatch;
      // Try to get end time from next matching line
      let timeEnd = timeStart;
      for (let j = i + 1; j < lines.length && j < i + 5; j++) {
        const nextMatch = lines[j].trim().match(timeRangePattern) || lines[j].trim().match(singleTimePattern);
        if (nextMatch) {
          timeEnd = nextMatch[1];
          break;
        }
      }
      const { title, speaker } = extractTitleAndSpeaker(rest);
      segments.push({
        title,
        speaker,
        timeStart: normalizeTime(timeStart),
        timeEnd: normalizeTime(timeEnd),
        durationMinutes: calcDuration(timeStart, timeEnd),
      });
      continue;
    }

    // If we already have segments, try to append multi-line content to previous segment title
    // Skip header lines
  }

  // If no timecodes found, split into segments by paragraph/block
  if (segments.length === 0) {
    return parseFallback(text);
  }

  return segments;
}

function extractTitleAndSpeaker(text: string): { title: string; speaker: string | null } {
  // Match "Спикер: Иванов" or "Корр.: Петров" patterns
  const speakerMatch = text.match(/(?:Спикер|Корр\.|Корреспондент|Ведущий|Автор):\s*([^.]+)/i);
  let speaker: string | null = null;
  let title = text;

  if (speakerMatch) {
    speaker = speakerMatch[1].trim();
    title = text.replace(speakerMatch[0], "").trim();
  }

  // Clean up title
  title = title.replace(/\s+/g, " ").trim();
  if (title.endsWith(".") || title.endsWith(",")) {
    title = title.slice(0, -1);
  }

  return { title: title || "Без названия", speaker };
}

function normalizeTime(time: string): string {
  const parts = time.split(":").map((p) => p.padStart(2, "0"));
  if (parts.length === 2) return `00:${parts[0]}:${parts[1]}`;
  return parts.join(":");
}

function parseFallback(text: string): ParsedSegment[] {
  // Try double-newline split first, then single-newline as fallback
  let blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 10);

  // If we only got 1-2 big blocks, the text uses single newlines — split by line instead
  if (blocks.length <= 2) {
    blocks = text
      .split("\n")
      .map((b) => b.trim())
      .filter((b) => b.length > 10);
  }

  // Limit to 50 segments
  return blocks.slice(0, 50).map((block, idx) => {
    const firstLine = block.split("\n")[0].slice(0, 160);
    const totalMins = idx * 3;
    const hh = String(Math.floor(totalMins / 60)).padStart(2, "0");
    const mm = String(totalMins % 60).padStart(2, "0");
    const hh2 = String(Math.floor((totalMins + 3) / 60)).padStart(2, "0");
    const mm2 = String((totalMins + 3) % 60).padStart(2, "0");
    const start = `${hh}:${mm}:00`;
    const end = `${hh2}:${mm2}:00`;
    return {
      title: firstLine,
      speaker: null,
      timeStart: start,
      timeEnd: end,
      durationMinutes: 3,
    };
  });
}
