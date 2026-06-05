# ГосАналитика Медиа

Платформа автоматизации медиа-аналитики: сбор, ИИ-классификация сюжетов теле/радиоэфира и YouTube, формирование Excel-отчётов.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — запустить API сервер (порт 8080)
- `pnpm --filter @workspace/media-analytics run dev` — запустить фронтенд
- `pnpm run typecheck` — полная проверка типов
- `pnpm run build` — typecheck + сборка всех пакетов
- `pnpm --filter @workspace/api-spec run codegen` — регенерировать API хуки и Zod схемы из OpenAPI спека
- `pnpm --filter @workspace/db run push` — применить изменения схемы БД (только dev)
- Требуется env: `DATABASE_URL` — строка подключения к Postgres
- Требуется env: `OPENAI_API_KEY` — ключ OpenAI для ИИ-классификатора

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite, TanStack Query, shadcn/ui, wouter
- AI: OpenAI GPT-4o-mini (классификация сюжетов)
- Excel: ExcelJS

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI контракт (источник истины)
- `lib/db/src/schema/directories.ts` — таблицы справочников и категорий
- `lib/db/src/schema/sessions.ts` — таблицы сессий и сюжетов
- `artifacts/api-server/src/routes/` — Express маршруты (directories, sessions, youtube)
- `artifacts/api-server/src/lib/` — бизнес-логика (aiClassifier, broadcastParser, categoryParser, excelGenerator, youtubeParser)
- `artifacts/media-analytics/src/pages/` — React страницы

## Architecture decisions

- OpenAPI-first: весь контракт в `openapi.yaml`, типы генерируются через Orval
- Классификация ИИ батчами по 5 параллельных запросов к GPT-4o-mini
- Парсинг верстки: regex для тайм-кодов в форматах HH:MM:SS, MM:SS, диапазонов
- Excel через ExcelJS с цветовой маркировкой строк (ИИ/ручной)
- YouTube: oEmbed для проверки видео, тайм-коды из описания

## Product

- **Шаг 1**: Загрузка справочника тематических направлений (вставка текста)
- **Шаг 2**: Новая сессия — выбор справочника + вставка верстки или YouTube URL
- **Шаг 3**: ИИ автоматически классифицирует сюжеты, пользователь корректирует в таблице
- **Шаг 4**: Скачать Excel-отчёт в один клик

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Запускать `pnpm run typecheck:libs` после изменений в `lib/*` перед проверкой артефактов
- После изменения `openapi.yaml` обязательно запустить codegen перед использованием типов
- ExcelJS: `writeBuffer()` возвращает `ArrayBuffer`, нужен `Buffer.from(...)` для конвертации

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
