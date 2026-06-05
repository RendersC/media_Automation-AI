---
name: ТЗ Excel export format and multi-category rule
description: Hard requirements from the ГосАналитика Медиа ТЗ for the Excel report and AI classification
---

# ТЗ contract for ГосАналитика Медиа

Source: `attached_assets/ТЕХНИЧЕСКОЕ_ЗАДАНИЕ_*.docx`.

**Excel export (ТЗ §4) — EXACTLY 5 columns, in order:**
1. Наименование тематического направления
2. Название программы
3. Тема передачи (ключевая мысль, спикер)
4. Хронометраж (минуты)
5. Дата выхода в эфир

No "Источник" or other extra columns. Multiple directions for one segment go in column 1 joined by newlines (single row per segment).

**AI classification (ТЗ §3):** match each segment to ОДНОМУ или НЕСКОЛЬКИМ directions, strictly using directory wording (no invented categories). Implemented as `segments.category_ids int[]`; AI returns validated id array; manual edits validated server-side against the session's directory.

**Why:** the user explicitly rejected the earlier single-category + 6-column output as not matching the ТЗ.
