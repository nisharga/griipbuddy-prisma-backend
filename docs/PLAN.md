# griipbuddy-prisma-backend — Build plan

## Goal

A production-grade **Express + TypeScript + Prisma + PostgreSQL** backend that exposes the **same API
contract as `project-server`** (≈115 endpoints), so `griipbuddy-admin-new` and the `special-biye`
storefront work against it unchanged. Core infrastructure is taken from `backend-server` (DeliGo) and
`zephix-server`; Prisma conventions from `0.portfolio-backend` (with its mistakes fixed).

## What comes from where

| Source                  | Taken                                                                                                                                                                                                                                                                       | Left out (why)                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **project-server**      | Every endpoint, path, request body and response shape; RBAC permission keys; order/stock rules (server-side pricing, reserve → ship → release); public vs admin split; seed data                                                                                            | Mongoose (→ Prisma)                                                                                                       |
| **backend-server**      | Folder layout (`modules/<name>/{routes,controller,service,validation}`), Redis rate limiting (`rate-limit-redis`), Redis service, BullMQ queue + worker, cron registry, handlebars email templates, nodemailer sender, `trust proxy`, CORS from env list, GitHub Actions CI | Socket.io, Firebase push, Stripe, Meilisearch, OpenAI/Gemini, Cloudinary, Google Maps (no feature in this shop uses them) |
| **zephix-server**       | Multi-stage Dockerfile (non-root), docker-compose, GHCR/DockerHub + SSH deploy workflow, BulkSMSBD SMS sender, audit log, graceful shutdown                                                                                                                                 | CRM modules (clients/invoices/contracts…), PDF invoices                                                                   |
| **0.portfolio-backend** | Prisma + Postgres, `prisma migrate`, `postinstall: prisma generate`                                                                                                                                                                                                         | `new PrismaClient()` per service (exhausts DB connections) → one shared client                                            |

## Key design decisions

1. **IDs:** Prisma `String @id @default(cuid())`. Every response object gets **both `_id` and `id`**
   (admin/storefront read `_id` 840×, `id` 73×; neither checks ObjectId format). Inputs accept any id string.
2. **Same response envelope** `{ statusCode, success, message, data, meta? }` and error shape
   `{ statusCode, success:false, message, errorMessages[] }`.
3. **Transactions & row locks** for stock: reservations use `UPDATE … SET available = available - n
WHERE available >= n` inside `prisma.$transaction` — no overselling, no manual rollback.
4. **Order numbers** from a Postgres sequence (`autoincrement`, starts at 1001).
5. **Redis is optional.** With `REDIS_URL` set → Redis rate-limit store + BullMQ notification queue.
   Without it → in-memory limiter + inline jobs. Same code paths, so dev needs only Postgres.
6. **Cron with a Postgres advisory lock** so only one instance runs a job when scaled horizontally.
7. **Config validated with Zod at boot** — the app refuses to start with a missing/invalid env var.
8. **Structured logging** (pino) with request ids; `pino-pretty` in development.
9. **Storage:** S3 when AWS vars are set, local disk (`/uploads`) otherwise — as in project-server.
10. **Notifications (opt-in by env):** SMS (BulkSMSBD) to the customer on order placed / shipped /
    delivered; email (SMTP + handlebars) for the daily low-stock digest.

## Folder structure

Folders: `src/{modules,middlewares,routes,jobs,config,constants,errors,helpers,interfaces,shared}`,
and each module as `<name>.route.ts` · `<name>.controller.ts` · `<name>.service.ts` · `<name>.validation.ts` · `index.ts`.
The full tree is in the [README](../README.md#project-layout).

## Data model (Prisma)

User · Role · BusinessLocation · Category · SubCategory (self-relation: parent → sub-sub) · Brand ·
ReturnPolicy · Product · ProductVariant · Stock (unique variant+location) · StockAdjustment +
StockAdjustmentItem · Supplier · Order · OrderItem · OrderStatusHistory · OrderLog · OrderNote ·
OrderCallLog · OrderStockAllocation · AuditLog. Free-form product fields (specs, sale channels,
social links, attribute values) are `Json`.

## Build order

1. **Scaffold** — package.json, tsconfig paths, lint/prettier, env, logger, prisma client, app/server,
   errors, response helpers, serializer, rate limit, health/readiness, graceful shutdown.
2. **Schema + migration + seed** (roles, super admin, sample catalog, starting stock).
3. **Modules** — auth/staff/roles/permissions → uploads → locations → categories → brands →
   return policies → products/variants → stock → orders → suppliers → storefront/CMS/track.
4. **Jobs** — queue, notification worker (SMS), cron (low-stock digest, audit-log retention).
5. **Tests** — port both test suites; run against a disposable Postgres.
6. **Deploy** — Dockerfile, compose, CI, deploy workflow, README run-book.
7. **Verify** — point admin + storefront at the new backend, load every page, run the shop flow.

## Not in scope (same as project-server today)

Customer accounts on the storefront, coupons, reviews/FAQ editors, banners/hero editors, courier
integration, POS, purchases, reports. The structure leaves a clear place to add each.
