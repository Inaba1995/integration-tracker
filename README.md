# Трекер интеграции: ИИ-ассистент ↔ 1С:Фитнес клуб

Веб-трекер проекта интеграции внешнего ИИ-ассистента (чат/голос) со студийным ПО **1С:Фитнес клуб** (студия пилатеса).
Команда (заказчик + исполнитель + ИИ-ассистент как актор) ведёт функции интеграции, фиксирует решения
«стандартный API / доработка / расширение», оценивает стоимость и сроки, отслеживает ошибки и дубли,
хранит результаты приёмки.

> Это **инструмент управления интеграцией**, а не сам ИИ-ассистент и не замена 1С.
> По умолчанию — **mock-режим**: реальные вызовы к 1С не выполняются.

---

## Быстрый старт

### Вариант 1. Docker (приложение + PostgreSQL)

```bash
cp .env.example .env      # при желании поменяйте секреты
docker-compose up --build
```

- Приложение: <http://localhost:4000> (API + UI из одного сервиса)
- БД: PostgreSQL 16 (том `pgdata`), схема и сиды применяются автоматически при старте (`docker/entrypoint.sh`)

### Вариант 2. Локально (SQLite, без Docker)

```bash
npm ci
npm --prefix ui ci
cp .env.example .env
npm run db:setup          # prisma generate + db push + сиды
npm run dev               # API :4000 (tsx watch) + UI :5173 (vite, прокси /api)
```

UI: <http://localhost:5173>, API: <http://localhost:4000/api/health>, OpenAPI: <http://localhost:4000/openapi.yaml>
(файл также лежит в [`docs/openapi.yaml`](docs/openapi.yaml), генерация: `npm run openapi`).

**Демо-доступы** (пароль у всех — `Password123!`):

| Email                      | Роль       | Права                                                         |
| -------------------------- | ---------- | ------------------------------------------------------------- |
| `admin@tracker.local`      | ADMIN      | всё, включая настройки mock/real и список пользователей       |
| `integrator@tracker.local` | INTEGRATOR | создание/изменение, операции (записи, синхронизация, повторы) |
| `viewer@tracker.local`     | VIEWER     | только чтение и отчёты                                        |

---

## Структура и архитектура

```
src/
├── domain/            # сущности, бизнес-правила, порты (OneCClient, репозитории) — без 1С и БД
│   ├── entities/      # Feature, IntegrationTask, ApiEndpoint, WebhookEvent, Booking, Lead, ...
│   ├── rules/         # idempotency, bookingRules, oneCErrors (маппинг), retryPolicy (exp, max 3)
│   └── ports/         # OneCClient, Repositories, RetryRunner, MinimalLogger
├── application/       # use-cases: заявки, записи/отмена/перенос, webhook, синхронизация,
│                      # повтор ошибок, отчёты, настройки, аудит
├── infrastructure/
│   ├── db/            # Prisma-репозитории (SQLite ⇄ PostgreSQL)
│   ├── onec/          # MockOneCClient (default) | RealOneCClient (флаг), фабрика
│   └── queue/         # RetryQueue: экспоненциальная задержка, max 3 → ErrorLog FAILED
└── interface/         # Fastify: маршруты, zod-валидация, JWT/роли, webhook-подпись,
                       # rate-limit, correlation-id, error-handler, OpenAPI-генератор
ui/                    # React + TypeScript + Vite + Tailwind (SPA, отдаётся бэкендом)
prisma/                # schema.prisma (SQLite) + postgres/schema.prisma + seed.ts
tests/                 # unit (правила, адаптер, ретраи) + integration (REST API)
docs/openapi.yaml      # OpenAPI 3.1
```

**Почему Fastify + отдельный SPA (а не Next.js):** трекер — внутреннее CRUD-приложение без SSR/SEO-потребностей;
Fastify даёт явную многослойность (domain/application/infrastructure/interface), быструю валидацию и плагины
(cors, jwt, rate-limit, static), а один Node-процесс в проде отдаёт и API, и собранный UI → `docker-compose up`
поднимает ровно два сервиса: `app` и `db`.

---

## Переменные окружения (`.env.example`)

| Переменная                     | По умолчанию          | Назначение                                             |
| ------------------------------ | --------------------- | ------------------------------------------------------ |
| `NODE_ENV`                     | development           | режим                                                  |
| `PORT`                         | 4000                  | порт API/UI                                            |
| `LOG_LEVEL`                    | info                  | уровень pino                                           |
| `DATABASE_URL`                 | `file:./dev.db`       | SQLite; для PG: `postgresql://user:pass@host:5432/db`  |
| `ONEC_MODE`                    | **mock**              | `mock` \| `real` — **реальные вызовы только по флагу** |
| `ONEC_BASE_URL` / `ONEC_TOKEN` | пусто                 | базовый URL и токен 1С (обязательны для `real`)        |
| `ONEC_TIMEOUT_MS`              | 5000                  | таймаут запросов к 1С                                  |
| `JWT_SECRET`                   | dev-значение          | секрет JWT (**обязателен свой в проде**)               |
| `WEBHOOK_SECRET`               | dev-значение          | HMAC-секрет вебхуков                                   |
| `CORS_ORIGIN`                  | http://localhost:5173 | разрешённый origin (через запятую)                     |

Секреты хранятся **только** в окружении; экран «Настройки» показывает лишь факт наличия (`tokenConfigured`).

---

## Ключевые сценарии демо

1. **Dashboard** → сводка: 6 фич по статусам и типам реализации, часы/₽, ошибки и дубли.
2. **Фичи** → фильтр «Тип реализации», inline-изменение оценки (например, F-04: 2 дня → 3), статус задач.
3. **API Explorer** → у «Расписание занятий» нажать **«Тестовый запрос»** → request/response + время (mock-симуляция).
4. **Webhook Console** → «+ Тестовое событие» → _«Отправить»_ → `PROCESSED`; **нажать ещё раз** (тот же ключ) → `DUPLICATE`
   (подсвечено; новых заявок не создаётся). Событие `wh-seed-3` (FAILED) → «Повторить».
5. **Записи и расписание** → «+ Записать клиента» (активный клиент + свободный слот) → `CONFIRMED`;
   повтор ключа → дубликат; **«Отменить»** → место освобождается (счётчик в слотах уменьшается);
   **«Перенести»** → выбор целевого слота; попытка записи в полный слот (пилатес на коврике, 12/12) → `NO_SEATS`;
   неактивный клиент (Сидорова Елена) → `CLIENT_INACTIVE`.
6. **Синхронизация расписания** → кнопка «⟳ Синхронизировать» → upsert слотов без дублей.
7. **Ошибки** → фильтр `FAILED`: `lead.send / ONEC_UNAVAILABLE / ретраи 3` → «Повторить» (после «починки» 1С) → `RESOLVED`.
8. **Отчёт** → «Стандартный API vs Доработки» → «Экспорт CSV» и «Печать / PDF».
9. **Настройки** (админ) → переключатель `mock ↔ real` (real недоступен без env), список ролей, ссылка на OpenAPI.

---

## REST API (кратко)

Полная спека — [`docs/openapi.yaml`](docs/openapi.yaml) (OpenAPI 3.1), доступна на `/openapi.yaml`.

- `POST /api/auth/login` → JWT; роли: `ADMIN | INTEGRATOR | VIEWER`
- `GET/POST/PATCH /api/features`, `/api/tasks`, `/api/endpoints` (+ `POST /api/endpoints/:id/test`)
- `POST /api/webhooks/1c` — идемпотентность (`idempotencyKey` → `DUPLICATE`), аутентификация:
  HMAC-подпись `x-webhook-signature` **или** `x-webhook-token` **или** валидный JWT, rate-limit 60/мин
- `GET /api/webhooks`, `POST /api/webhooks/:id/reprocess`
- `GET/POST /api/leads`, `GET /api/clients`, `POST /api/clients`
- `GET/POST/PATCH /api/bookings`, `POST /api/bookings/:id/cancel`, `POST /api/bookings/:id/reschedule`
- `GET /api/schedule`, `POST /api/schedule/sync`, `GET /api/services`, `GET /api/specialists`
- `GET /api/errors`, `POST /api/errors/:id/retry`
- `GET/POST /api/estimates`
- `GET /api/reports/summary`, `/api/reports/standard-vs-custom`, `/api/reports/standard-vs-custom.csv`
- `GET/PATCH /api/settings`, `GET /api/users`, `GET /api/health`

Бизнес-правила: идемпотентность по ключу; проверка мест/слота/активности клиента
(`NO_SEATS`, `SLOT_TAKEN`, `CLIENT_INACTIVE`); отмена/перенос только для `CONFIRMED` (отмена освобождает место);
ошибки 1С маппятся во внутренние коды, ретраи экспоненциальные (1s→2s→4s, max 3) → `ErrorLog` `FAILED`;
все изменения пишутся в `AuditLog`.

---

## Тесты, линт, CI

```bash
npm run lint        # ESLint (api + ui)
npm run typecheck   # TypeScript strict (api + ui)
npm test            # Vitest: 66 тестов (unit + integration на тестовой SQLite с сидами)
npm run build       # ui + api + seed
npm run openapi     # генерация docs/openapi.yaml
```

CI: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — `lint → typecheck → test → build → openapi`.

Интеграционные тесты используют отдельную базу `prisma/test.db`
(пересоздаётся и сидируется в `tests/integration/globalSetup.ts`).

---

## Деплой на Railway

Репозиторий уже настроен: [`railway.json`](railway.json) (сборка через **Dockerfile**, healthcheck
`/api/health`, рестарт при падении). Контейнер при старте сам применяет схему PostgreSQL и сиды
(`docker/entrypoint.sh`).

1. **Создайте проект и сервис из репозитория**
   ```bash
   railway init            # в каталоге проекта (или Railway Dashboard → Create → GitHub repo)
   railway up              # деплой из текущей директории, либо подключите репозиторий в Dashboard
   ```
2. **Добавьте базу данных**
   ```bash
   railway add --database postgres
   ```
   Railway автоматически подставит `DATABASE_URL` в сервис приложения
   (схема автоматически переключается на `prisma/postgres/schema.prisma` — она используется в контейнере).
3. **Переменные окружения** (Dashboard → Variables или `railway variables set`):
   | Переменная                    | Значение                                                                               |
   | ----------------------------- | -------------------------------------------------------------------------------------- |
   | `JWT_SECRET`                  | сгенерируйте: `openssl rand -hex 32`                                                   |
   | `WEBHOOK_SECRET`              | сгенерируйте: `openssl rand -hex 32`                                                   |
   | `CORS_ORIGIN`                 | `https://<ваш-домен>.railway.app`                                                      |
   | `ONEC_MODE`                   | `mock` (по умолчанию) — переключайте на `real` только с `ONEC_BASE_URL` + `ONEC_TOKEN` |
   | `LOG_LEVEL`                   | `info`                                                                                 |
   | `ONEC_BASE_URL`, `ONEC_TOKEN` | только для real-режима 1С (хранить в Variables, не в коде)                             |
   > `DATABASE_URL` и `PORT` Railway передаёт автоматически — задавать вручную не нужно.
4. **Домен**: Settings → Networking → Generate Domain (или свой), затем пропишите его в `CORS_ORIGIN`.
5. Проверка: `GET /api/health` → `{"status":"ok","mode":"mock"}`, UI открывается на корневом пути.

Первый деплой применит схему и посеет демо-данные; повторные деплои идемпотентны
(сиды пропускаются, если фича `F-01` уже существует; полная пересидка — `SEED_FORCE=1`).

---

## Переход на real-режим 1С

1. Уточните у заказчика версию/конфигурацию 1С:Фитнес клуб и фактический контракт API
   (в ТЗ прямо указано, что версия уточняется).
2. Задайте в окружении: `ONEC_MODE=real`, `ONEC_BASE_URL`, `ONEC_TOKEN`, при необходимости `ONEC_TIMEOUT_MS`.
3. Приведите маршруты 1С к ожидаемым адаптером (`/leads`, `/schedule`, `/services`, `/specialists`,
   `/bookings`, `/bookings/{id}/cancel`, `/bookings/{id}/reschedule` — см. `src/infrastructure/onec/RealOneCClient.ts`)
   либо скорректируйте `RealOneCClient` под фактический контракт — **домен и UI не меняются**.
4. Проверьте сигнатуру кодов ошибок 1С и при необходимости дополните карту `src/domain/rules/oneCErrors.ts`.
5. Прогоните демо-сценарий выше в real-режиме; тестовые мутирующие запросы в real заблокированы (защита данных).
6. Включите HTTPS и сильные `JWT_SECRET`/`WEBHOOK_SECRET`; при необходимости развёртывания на PostgreSQL —
   `DATABASE_URL=postgresql://...` (в Docker уже PostgreSQL).

## Известные ограничения

- Реальные вызовы к 1С не проверялись (контракт версии 1С:Фитнес неизвестен) — только mock + юнит-тесты HTTP-клиента.
- Перенос/отмена и «передача обращений администратору» помечены `TBD/EXTENSION`: зависят от возможностей
  конкретной версии 1С (по ТЗ требуется уточнение у заказчика).
- Playwright (e2e) — опциональный этап: конфиг и тесты не включены, покрытие сценариев — интеграционными тестами API.
- `docker-compose` требует Docker в среде разработки/CI; локально в этой среде Docker недоступен —
  конфигурация написана по стандартному шаблону (app + postgres, healthcheck, автосиды).
- Очередь ретраев — в памяти процесса (перезапуск сбрасывает ожидающие попытки); постоянство — через `ErrorLog` с кнопкой «Повторить».
