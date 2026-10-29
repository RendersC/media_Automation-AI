import { openai, MODELS } from "./openai";
import { logger } from "./logger";

interface Category {
  id: number;
  code: string | null;
  title: string;
}

interface ClassificationResult {
  categoryIds: number[];
}

/**
 * How to map a сюжет to направления. Shared by the batched (gpt-4o) classifier
 * and the per-segment (gpt-4o-mini) fallback so both behave consistently.
 */
const MATCHING_RULES = `КАК СОПОСТАВЛЯТЬ:
- Сопоставляй по СМЫСЛУ и ТЕМЕ сюжета, а не по дословному совпадению слов. Направления сформулированы канцелярски («Информационное сопровождение …»), а сюжеты — обычным языком. Сюжет относится к направлению, если его предмет входит в тематическую область этого направления, даже если формулировки разные.
- Ориентиры (примеры соответствий):
  • визиты, встречи, заявления, решения Президента, Парламента, Правительства, акимов и госорганов → направление о деятельности Главы государства / гос. органов;
  • визиты иностранных лидеров, международные соглашения и сотрудничество РК → направление о внешней/международной политике;
  • происшествия на производстве, нарушение трудовых прав, охрана труда, занятость → направление о политике в области труда;
  • преступления, наркотики, коррупция, ДТП, задержания, работа полиции, судов, приговоры → направление о правопорядке / верховенстве закона;
  • здравоохранение, медицина, происшествия со здоровьем граждан → направление о здравоохранении / соц. защите;
  • люди с инвалидностью, паралимпийский спорт, поддержка лиц с ограниченными возможностями → направление о поддержке людей с ограниченными возможностями;
  • спорт, турниры, культура, образование, наука → соответствующие профильные направления.
- Если сюжет затрагивает несколько тем — укажи несколько направлений.
- Выбирай направления ТОЛЬКО из приведённого Справочника по их числовым ID. Не придумывай свои формулировки.

КОГДА ВОЗВРАЩАТЬ ПУСТО:
- Пустой список возвращай ТОЛЬКО для служебных/церемониальных фрагментов (приветствие, прощание, подводка, анонс, прогноз погоды, отбивка) ИЛИ если сюжет вообще не относится ни к одной общественной, государственной, социальной, экономической, правовой или культурной теме.
- Во всех остальных случаях подбери хотя бы одно наиболее близкое по смыслу направление.`;

/**
 * Categories are identified to the model by their код (e.g. "2.4") — that is the
 * canonical taxonomy key and the model reliably echoes it back (it ignores the
 * internal DB id). We map the returned codes back to DB ids ourselves. Falls
 * back to the stringified DB id for entries without a код.
 */
function categoryKey(c: Category): string {
  return c.code ?? `id${c.id}`;
}

function buildCategoryList(categories: Category[]): string {
  return categories.map((c) => `[${categoryKey(c)}] ${c.title}`).join("\n");
}

/** Map the model's returned codes/keys back to valid DB ids. */
function codesToIds(codes: unknown, keyToId: Map<string, number>): number[] {
  if (!Array.isArray(codes)) return [];
  const ids: number[] = [];
  for (const raw of codes) {
    // The model may emit a code as a string ("2.4") or a JSON number (2.4).
    const key = typeof raw === "number" ? String(raw) : String(raw ?? "").trim();
    const id = keyToId.get(key);
    if (id !== undefined) ids.push(id);
  }
  return [...new Set(ids)];
}

function buildKeyToId(categories: Category[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of categories) m.set(categoryKey(c), c.id);
  return m;
}

/**
 * Per-segment classifier (gpt-4o-mini). Kept as a resilient fallback for the
 * batched classifier; mini has a high TPM ceiling so a per-segment retry can
 * never trip the gpt-4o rate limit.
 */
export async function classifySegment(
  segmentTitle: string,
  segmentText: string,
  categories: Category[]
): Promise<ClassificationResult> {
  if (categories.length === 0) {
    return { categoryIds: [] };
  }

  const prompt = `Ты — эксперт по государственной информационной политике. Сопоставь сюжет эфира с ОДНИМ или НЕСКОЛЬКИМИ тематическими направлениями из Справочника-2026.

${MATCHING_RULES}

СЮЖЕТ:
Название: ${segmentTitle}
${segmentText ? `Содержание: ${segmentText}` : ""}

СПРАВОЧНИК ТЕМАТИЧЕСКИХ НАПРАВЛЕНИЙ (код в квадратных скобках):
${buildCategoryList(categories)}

Ответь СТРОГО в формате JSON без пояснений: {"codes": [<коды направлений из справочника, строками, например "2.4">]}.`;

  try {
    const response = await openai.chat.completions.create({
      model: MODELS.mini,
      max_tokens: 100,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content?.trim() ?? "{}";
    let codes: unknown;
    try {
      codes = (JSON.parse(content) as { codes?: unknown }).codes;
    } catch {
      codes = [];
    }

    return { categoryIds: codesToIds(codes, buildKeyToId(categories)) };
  } catch (err) {
    logger.error({ err }, "AI classification failed");
    return { categoryIds: [] };
  }
}

/** One gpt-4o call classifies a chunk of сюжеты against the full directory. */
async function classifyChunk(
  chunk: Array<{ id: number; title: string; text?: string }>,
  categoryList: string,
  keyToId: Map<string, number>
): Promise<Map<number, ClassificationResult>> {
  const segmentsBlock = chunk
    .map(
      (s) =>
        `[#${s.id}] Название: ${s.title}${s.text ? `\n    Содержание: ${s.text}` : ""}`
    )
    .join("\n\n");

  const prompt = `Ты — эксперт по государственной информационной политике. Для КАЖДОГО сюжета эфира из списка ниже подбери тематические направления из Справочника-2026.

${MATCHING_RULES}

СПРАВОЧНИК ТЕМАТИЧЕСКИХ НАПРАВЛЕНИЙ (код в квадратных скобках):
${categoryList}

СЮЖЕТЫ ЭФИРА (у каждого свой числовой ключ после #):
${segmentsBlock}

Верни направления для КАЖДОГО сюжета по его ключу. Ответь СТРОГО в формате JSON без пояснений:
{"results": [{"id": <числовой ключ сюжета после #>, "codes": [<коды направлений из справочника, строками, например "2.4">]}, ...]}.
Включи в "results" все сюжеты; для служебных/нетематических — "codes": [].`;

  const response = await openai.chat.completions.create({
    model: MODELS.main,
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content?.trim() ?? "{}";
  const parsed = JSON.parse(content) as { results?: unknown };
  const results = new Map<number, ClassificationResult>();

  if (Array.isArray(parsed.results)) {
    for (const item of parsed.results) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const id = typeof obj.id === "number" ? obj.id : parseInt(String(obj.id), 10);
      if (isNaN(id)) continue;
      results.set(id, { categoryIds: codesToIds(obj.codes, keyToId) });
    }
  }

  return results;
}

/**
 * Classify a session's сюжеты in as few model calls as possible.
 *
 * The directory can be large (~38 канцелярских направлений ≈ 5k tokens), so we
 * send the directory + up to CHUNK_SIZE сюжеты in a SINGLE gpt-4o request and
 * read back all classifications at once. One batched call (instead of N parallel
 * per-segment calls) keeps us under the org's 30k TPM gpt-4o limit while using
 * the stronger model. If a chunk call fails (network/parse/429), we fall back to
 * resilient per-segment gpt-4o-mini classification for just that chunk.
 */
export async function classifySegmentsBatch(
  segments: Array<{ id: number; title: string; text?: string }>,
  categories: Category[]
): Promise<Map<number, ClassificationResult>> {
  const results = new Map<number, ClassificationResult>();
  if (segments.length === 0) return results;
  if (categories.length === 0) {
    for (const s of segments) results.set(s.id, { categoryIds: [] });
    return results;
  }

  const keyToId = buildKeyToId(categories);
  const categoryList = buildCategoryList(categories);

  // Bound output size / per-call tokens; for a typical эфир this is one call.
  const CHUNK_SIZE = 25;
  for (let i = 0; i < segments.length; i += CHUNK_SIZE) {
    const chunk = segments.slice(i, i + CHUNK_SIZE);
    try {
      const map = await classifyChunk(chunk, categoryList, keyToId);
      for (const seg of chunk) {
        results.set(seg.id, map.get(seg.id) ?? { categoryIds: [] });
      }
    } catch (err) {
      logger.warn(
        { err, chunkStart: i, chunkSize: chunk.length },
        "Batched gpt-4o classification failed, falling back to per-segment gpt-4o-mini"
      );
      for (const seg of chunk) {
        results.set(seg.id, await classifySegment(seg.title, seg.text ?? "", categories));
      }
    }
  }

  return results;
}
