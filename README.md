# griipbuddy-prisma-backend

E-commerce API for the GriipBuddy **admin panel** (`griipbuddy-admin-new`) and **storefront** (`special-biye`).
Express · TypeScript · Prisma · PostgreSQL · optional Redis (rate limits + BullMQ jobs).

It serves the same API as `project-server` (same paths, request bodies and response shapes), so both
frontends work without changes. See [`docs/PLAN.md`](docs/PLAN.md) for the design and where each part came from.

## Run locally

```bash
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL (+ test database)
cp .env.example .env                             # then set JWT_ACCESS_SECRET / JWT_REFRESH_SECRET
npm install                                      # also runs `prisma generate`
npm run db:deploy                                # apply migrations
npm run db:seed                                  # roles, super admin, sample catalog + stock
npm run dev                                      # http://localhost:5007
```

Login: **01700000000 / Admin@12345** (change with `SEED_ADMIN_*` before seeding).
Redis is optional: set `REDIS_URL` to use it, or `docker compose -f docker-compose.dev.yml --profile redis up -d`.

Point the frontends at it (`.env.local` in each):

| App        | Variable                                                   |
| ---------- | ---------------------------------------------------------- |
| Admin      | `NEXT_PUBLIC_BASE_SERVER_API=http://localhost:5007/api/v1` |
| Storefront | `NEXT_PUBLIC_API_BASE_URL=http://localhost:5007/api/v1`    |

Both also need `localhost:5007` allowed under `images.remotePatterns` in `next.config.ts` for local uploads.

## Scripts

| Command                                                  | What it does                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`                                            | Start with hot reload                                                        |
| `npm run build` / `npm start`                            | Compile to `dist/` / run the compiled server                                 |
| `npm test`                                               | Integration tests against the `griipbuddy_test` database (never the dev one) |
| `npm run lint` · `npm run type-check` · `npm run format` | Code quality                                                                 |
| `npm run db:migrate`                                     | Create + apply a migration after editing `prisma/schema.prisma`              |
| `npm run db:deploy`                                      | Apply pending migrations (production)                                        |
| `npm run db:seed`                                        | Idempotent seed                                                              |
| `npm run db:studio`                                      | Browse the database                                                          |

## Project layout

Same layout as `0.portfolio-backend`:

```
prisma/                 schema, migrations, seed
src/
├─ app.ts · server.ts   express app · process entry (graceful shutdown, jobs, cron)
├─ app/
│  ├─ middlewares/      auth, globalErrorHandler, notFound, rateLimiter, requestLogger, validateRequest
│  ├─ modules/          index.ts re-exports every module
│  │  └─ <name>/        <name>.route.ts · <name>.controller.ts · <name>.service.ts · <name>.validation.ts · index.ts
│  ├─ routes/index.ts   moduleRoutes = [{ path, route }] + /health
│  └─ jobs/             queue (BullMQ or inline), job handlers, cron
├─ config/index.ts      env validated with Zod at boot (default export `config`)
├─ constants/           pagination, permissions & roles
├─ errors/              ApiError, handlePrismaError, handleZodError
├─ helpers/             pagination, query, jwt, password, permission, slug, file storage, SMS, email, audit log
├─ interfaces/          common, error, pagination, index.d.ts (req.user)
├─ shared/              catchAsync, pick, sendResponse, serialize, prisma, logger, redis
└─ views/               email templates (Handlebars)
tests/                  Vitest + Supertest integration tests
```

**Module pattern:** the route wires middleware → the controller reads the request and calls the
service → the service holds all business logic and database access → `sendResponse` shapes the reply.

Modules: `user` · `role` · `permission` · `upload` · `businessLocation` · `category` · `subCategory` ·
`brand` · `returnPolicy` · `product` · `stock` · `order` · `supplier` · `cms` · `review` · `faq` (product Q&A).

### Conventions

- **Responses:** `{ statusCode, success, message, data, meta? }`; errors add `errorMessages[]`.
- **IDs:** every object has both `_id` and `id`. Foreign keys are exposed under the relation name —
  the object when included, the id otherwise (`brand_id` → `brand`), like the old Mongo API.
- **Money** is `Decimal(12,2)` in the database and a number in JSON. Prices and totals are always
  computed on the server.
- **Stock** is one row per variant × location (`available` + `reserved`). Orders reserve stock in a
  transaction; status changes move it (shipped → removed, cancelled → released, returned → restocked).
  CHECK constraints keep quantities ≥ 0.
- **Public vs admin:** storefront reads and `POST /order` are public; everything else needs a staff
  token and the matching permission (`src/lib/rbac.ts`).

## Background work

- **Jobs** (`src/jobs`): customer SMS on order placed / shipped / delivered / cancelled. With Redis they
  run through BullMQ (3 retries, exponential backoff); without Redis they run in-process.
- **Cron** (Asia/Dhaka, Postgres advisory lock so only one instance runs each job):
  - 09:00 — low-stock email to `ADMIN_ALERT_EMAILS`
  - 03:30 — delete audit logs older than `AUDIT_LOG_RETENTION_DAYS`

## Deploy

**Docker (recommended).** On the server:

```bash
cp .env.example .env        # NODE_ENV=production, real secrets, POSTGRES_PASSWORD, CORS_ORIGINS, SERVER_BASE_URL
docker compose up -d --build
docker compose exec api npm run db:seed    # first time only: roles + super admin
```

The container applies migrations on start (`RUN_MIGRATIONS=false` to disable), runs as a non-root
user, exposes a health check at `/api/v1/health`, and shuts down gracefully on `SIGTERM`.
Put nginx (or another TLS proxy) in front; `TRUST_PROXY=1` makes rate limits use the real client IP.

**CI/CD (GitHub Actions).**

- `ci.yml` — every push/PR: lint, type-check, migrations from scratch, tests on Postgres, build, Docker build.
- `deploy.yml` — push to `production`: build → push to GHCR → SSH to the server → pull + restart → health check.
  Secrets: `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `DEPLOY_PATH`.

## Not built yet

Same scope as `project-server`: storefront customer accounts, coupons, reviews and banner/hero
editors (they return empty data), courier integration, POS, purchases, reports.
# griipbuddy-prisma-backend
