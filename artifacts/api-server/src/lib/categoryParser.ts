interface ParsedCategory {
  code: string | null;
  title: string;
}

/**
 * Parses a raw text document and extracts thematic direction categories.
 * Handles numbered lists like:
 *   1. Title
 *   1.1 Sub-title
 *   I. Title
 *   - Title
 */
export function parseCategories(rawText: string): ParsedCategory[] {
  const categories: ParsedCategory[] = [];
  const lines = rawText.split("\n");

  const patterns = [
    // Numbered with dot: "1.", "1.1.", "2.3.4."
    /^(\d+(?:\.\d+)*\.?)\s+(.+)/,
    // Roman numerals: "I.", "II.", "III."
    /^([IVXLCDM]+\.)\s+(.+)/i,
    // Dashes or bullets: "- Title", "• Title"
    /^[-•*]\s+(.+)/,
    // Just lines that look like category titles (all caps or Title Case longer words)
    /^([А-ЯA-Z][А-ЯA-Za-zА-яa-z\s]{10,})/,
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 5) continue;

    // Skip lines that look like headers/metadata
    if (/^\d{4}$/.test(trimmed)) continue;
    if (/^страниц|^раздел|^глава|^содержание/i.test(trimmed)) continue;

    const [, codeMatch, titleMatch] = trimmed.match(patterns[0]) ?? [];
    if (codeMatch && titleMatch && titleMatch.length > 3) {
      categories.push({ code: codeMatch.replace(/\.$/, ""), title: titleMatch.trim() });
      continue;
    }

    const [, romanCode, romanTitle] = trimmed.match(patterns[1]) ?? [];
    if (romanCode && romanTitle && romanTitle.length > 3) {
      categories.push({ code: romanCode.replace(/\.$/, ""), title: romanTitle.trim() });
      continue;
    }

    const bulletMatch = trimmed.match(patterns[2]);
    if (bulletMatch && bulletMatch[1].length > 5) {
      categories.push({ code: null, title: bulletMatch[1].trim() });
    }
  }

  // Deduplicate by title
  const seen = new Set<string>();
  return categories.filter((c) => {
    if (seen.has(c.title)) return false;
    seen.add(c.title);
    return true;
  });
}
