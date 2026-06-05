---
name: Unified session field sources
description: User-confirmed source-of-truth for each of the 5 ТЗ report columns in the unified session flow.
---

# Unified session: which input feeds which column

One session takes THREE inputs together — справочник (directory) + вёрстка (broadcast script) + a direct video URL — and produces the 5-column ТЗ table. The user explicitly confirmed (via user_query) the combined "Вместе" flow and these field sources:

- **Наименование направления** — AI classification against the session's справочник (one-or-many directions, strictly from that directory).
- **Название программы** — AI inferred from вёрстка + video context. A user-typed program name (optional field) wins when provided; otherwise AI decides. By default the field is empty, so AI normally determines it.
- **Тема передачи (мысль, спикер)** — topics + speaker come from the вёрстка, not the transcript.
- **Хронометраж** — timing comes from the VIDEO transcript, not the вёрстка timecodes.
- **Дата выхода** — extracted from the VIDEO filename (DD-MM-YY → ISO, with real calendar validation; fallback /YYYY/MM/DD path). User-entered date is the fallback when extraction fails.

**Why:** The вёрстка is the editorial source of meaning (what was said, by whom); the video is the source of ground-truth timing and air date. Keeping these separated avoids the AI hallucinating timings from prose or topics from raw speech.

**How to apply:** The merge step sends вёрстка + the video's timed transcript to a single model call. If that call fails or yields nothing, fall back deterministically: take вёрстка topics and spread them evenly across the video's real time span (chronometry still derives from video duration). Do not "simplify" this fallback away — it keeps a long/odd broadcast from failing the whole session.
