# ГосАналитика Медиа

Платформа автоматизации медиа-аналитики: сбор и ИИ-классификация сюжетов теле/радиоэфира и YouTube по справочнику тематических направлений, формирование Excel-отчётов.

**Как это работает (объединённый поток):** загружаешь справочник направлений → создаёшь сессию (справочник + вёрстка эфира + ссылка на видео) → платформа расшифровывает речь (Whisper), сопоставляет вёрстку с видео (gpt-4o), классифицирует сюжеты по справочнику и собирает таблицу → скачиваешь Excel.

Итоговые колонки отчёта: **Наименование тематического направления · Название программы · Тема передачи (ключевая мысль, спикер) · Хронометраж (мин:сек) · Дата выхода в эфир**.

---

## Запуск через Docker (рекомендуется)

Нужен только установленный **Docker Desktop**. Всё остальное (Postgres, ffmpeg, yt-dlp) поднимается в контейнерах.

```bash
# 1. Скопировать шаблон переменных окружения и вписать свой ключ OpenAI
cp .env.example .env
#   затем открыть .env и задать OPENAI_API_KEY=sk-...

# 2. Собрать и запустить весь стек
docker compose up -d --build
```

Открыть приложение: **http://localhost:8082**
API напрямую (для отладки): **http://localhost:8092/api/healthz**

Полезные команды:

```bash
docker compose logs -f api      # логи API (расшифровка/классификация)
docker compose ps               # статус сервисов
docker compose down             # остановить стек (данные БД сохраняются в volume)
docker compose down -v          # остановить и удалить данные БД
docker compose up -d --build    # пересобрать после изменений в коде
```

Сервисы: `db` (PostgreSQL + volume), `migrate` (разово применяет схему БД и выходит), `api` (Express + ffmpeg + yt-dlp), `web` (статика на nginx, проксирует `/api` к `api`).

### Переменные окружения (`.env`)

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `OPENAI_API_KEY` | Ключ OpenAI (Whisper + классификация) — **обязателен** | — |
| `POSTGRES_PASSWORD` | Пароль БД | `devpass` |
| `POSTGRES_DB` | Имя БД | `gosanalitika` |
| `WEB_PORT` | Порт веб-интерфейса на хосте | `8082` |
| `API_PORT` | Порт API на хосте | `8092` |

> `.env` хранит секреты и **не коммитится** в репозиторий (см. `.gitignore`). В репозитории только шаблон `.env.example`.

---

## Локальная разработка (без Docker)

**Требуется:** Node.js 24, `corepack` (даёт pnpm 11.5.2), PostgreSQL, `ffmpeg` и `yt-dlp` в `PATH`.

```bash
corepack enable
corepack pnpm install

# переменные окружения
export DATABASE_URL="postgres://postgres:devpass@localhost:5432/gosanalitika"
export OPENAI_API_KEY="sk-..."

# применить схему БД
corepack pnpm --filter @workspace/db run push

# API-сервер (порт 8080)
PORT=8080 corepack pnpm --filter @workspace/api-server run dev

# Фронтенд (в отдельном терминале). API_PROXY_TARGET — куда проксировать /api
PORT=5173 BASE_PATH=/ API_PROXY_TARGET="http://localhost:8080" \
  corepack pnpm --filter @workspace/media-analytics run dev
```

Прочие команды:

```bash
corepack pnpm run typecheck                              # проверка типов всего воркспейса
corepack pnpm --filter @workspace/api-spec run codegen   # регенерация API-клиента и Zod-схем из OpenAPI
```

> На Windows запускайте фронтенд из PowerShell (Git Bash искажает `BASE_PATH=/`). Подробности и нюансы платформы — в истории настройки проекта.

---

## Стек

- **Монорепозиторий:** pnpm workspaces, Node.js 24, TypeScript 5.9
- **API:** Express 5, сборка одним бандлом через esbuild
- **БД:** PostgreSQL + Drizzle ORM, схема — источник истины
- **Контракт:** OpenAPI (`lib/api-spec/openapi.yaml`) → Orval (хуки) + Zod-схемы
- **Фронтенд:** React + Vite, TanStack Query, shadcn/ui, wouter
- **ИИ:** OpenAI — Whisper (расшифровка), gpt-4o (сопоставление вёрстки и классификация по кодам направлений)
- **Видео:** ffmpeg (извлечение аудио), yt-dlp (загрузка с YouTube), прямые ссылки на файлы
- **Excel:** ExcelJS

## Структура

```
lib/db                  — схема БД (Drizzle): справочники, сессии, сюжеты
lib/api-spec            — OpenAPI-контракт (источник истины)
lib/api-zod             — Zod-схемы из контракта
lib/api-client-react    — сгенерированный API-клиент (React Query)
artifacts/api-server    — Express API: маршруты, ИИ-классификация, парсинг вёрстки,
                          расшифровка видео/YouTube, генерация Excel
artifacts/media-analytics — веб-интерфейс (React + Vite)
Dockerfile.api / Dockerfile.web / docker-compose.yml — контейнеризация
```
