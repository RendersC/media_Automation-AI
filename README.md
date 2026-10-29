# ГосАналитика Медиа
<img width="1918" height="901" alt="image" src="https://github.com/user-attachments/assets/429b2e4e-f10c-4e8a-a84e-15bb38634a4b" />

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
| `ADMIN_EMAIL` | Email первого администратора (создаётся при старте) | — |
| `ADMIN_PASSWORD` | Пароль первого администратора | — |
| `COOKIE_SECURE` | `true` только при работе по HTTPS | `false` |

> `.env` хранит секреты и **не коммитится** в репозиторий (см. `.gitignore`). В репозитории только шаблон `.env.example`.

### Доступ и роли (RBAC)

Приложение защищено входом. Роли: **администратор** и **работник**.

- **Первый администратор** создаётся автоматически при старте из `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Войди под ним и сразу смени пароль (Профиль).
- **Администратор** управляет пользователями в разделе «Пользователи»: создаёт учётки (выдаёт временный пароль), меняет роли, отключает, сбрасывает пароли, удаляет.
- **Работник** пользуется платформой (сессии, справочники, отчёты) и может сменить свой пароль в «Профиле».
- Созданному пользователю выдаётся **временный пароль**, который он обязан сменить при первом входе. Публичной регистрации нет — учётки заводит только админ.

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

## Деплой на Railway (одним сервисом — рекомендуется)

`Dockerfile.railway` собирает и API, и веб-интерфейс; API сам отдаёт фронтенд (`STATIC_DIR`). Один домен, Vercel не нужен, cookie обычные (SameSite=Lax).

1. New Project → **Deploy from GitHub repo** → этот репозиторий (подхватится `railway.json`, healthcheck `/api/healthz`).
2. Добавь **Database → PostgreSQL**.
3. Variables сервиса: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `OPENAI_API_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `COOKIE_SECURE=true`.
4. Settings → Networking → **Generate Domain**. Открыть домен — это и есть приложение.

> Держи **одну реплику**: фоновые задачи расшифровки живут в процессе. При перезапуске незавершённые сессии помечаются ошибкой (их нужно создать заново).

## Альтернатива: фронтенд на Vercel + бэкенд на Railway

> Бесплатный тариф Vercel (Hobby) — только для некоммерческого использования. Для заказчика проще вариант выше.

### Бэкенд → Railway
1. New Project → **Deploy from GitHub repo** → выбери репозиторий. Railway подхватит `railway.json` (сборка по `Dockerfile.railway`).
2. В проект добавь **Database → PostgreSQL**.
3. В сервисе бэкенда (Variables) задай:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (ссылка на БД Railway)
   - `OPENAI_API_KEY` = свой ключ
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD` = первый администратор
   - `COOKIE_SECURE=true`, `COOKIE_SAMESITE=none`
   - `CORS_ORIGINS=https://<твой-фронт>.vercel.app` (добавишь после деплоя фронта)
   - `PORT` задаётся Railway автоматически — трогать не нужно.
4. Деплой. Схема БД применится при старте автоматически. Открой публичный URL сервиса → `…/api/healthz` должен вернуть `{"status":"ok"}`.

### Фронтенд → Vercel
1. New Project → импортируй тот же репозиторий. Vercel подхватит `vercel.json` (сборка фронта из монорепо).
2. В Environment Variables задай:
   - `VITE_API_URL=https://<твой-бэкенд>.up.railway.app`
3. Деплой. Затем впиши полученный домен Vercel в `CORS_ORIGINS` бэкенда на Railway.

> Фронт и бэк на разных доменах → авторизация работает на cross-site cookie (`SameSite=None; Secure`), поэтому HTTPS (он есть и на Vercel, и на Railway) и точный `CORS_ORIGINS` обязательны.

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
