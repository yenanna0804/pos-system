# SQLite Migration Plan (Step by Step)

This plan is designed for the current codebase, which uses raw PostgreSQL SQL heavily.

## Goal

- Add SQLite support with minimal disruption to API contracts.
- Keep current behavior parity where possible.
- Migrate in phases so the app stays runnable during transition.

## Branch

- Working branch: `sqlite-migration`

## Important reality check

- This is not a config-only change.
- Current services (`orders`, `products`, `tables`, `reports`, `auth`) contain many PG-specific queries.
- The fastest safe path is incremental compatibility mode, then parity hardening.

---

## Phase 0 - Baseline and scope lock

1. Freeze API contract expectations.
   - Export all existing endpoints + response examples from current backend.
2. Define migration scope.
   - v1 SQLite target: auth, branches, tables, products, orders (core CRUD).
   - v2 SQLite target: reports parity and edge-case parity.
3. Capture regression baseline.
   - Add integration snapshots for key endpoints before refactor.

Deliverables:
- `docs/sqlite/api-parity-checklist.md`
- Baseline test fixtures for auth/products/orders/reports.

---

## Phase 1 - Introduce database adapter boundary

1. Add a DB abstraction layer.
   - Keep `PgService` as one implementation.
   - Add `SqliteService` (new implementation).
2. Add provider switch by env.
   - Example env: `DB_DIALECT=postgres|sqlite`
   - `DATABASE_URL` for postgres; `SQLITE_PATH` for sqlite.
3. Ensure transaction API parity.
   - `withTransaction` should expose same call shape for both.

Deliverables:
- `src/database/db.service.ts` interface
- `src/database/pg.service.ts` and `src/database/sqlite.service.ts` implementations
- App module provider wiring by `DB_DIALECT`

---

## Phase 2 - Schema port to SQLite

1. Create SQLite schema migration files.
   - Convert enum columns to `TEXT` + `CHECK` constraints.
   - Convert JSONB columns to `TEXT` (JSON string) or SQLite JSON fields.
2. Add bootstrap script for SQLite schema creation.
3. Port seed flow.
   - Keep same seed env semantics.

Deliverables:
- `scripts/sqlite/init.sql`
- `scripts/sqlite/seed.ts`
- SQLite-compatible schema guard (or disable with explicit flag)

---

## Phase 3 - Query compatibility pass (module by module)

Order of migration (low-risk to high-risk):

1. `auth`
   - Replace PG casts and assumptions.
2. `branches`
   - Simple selects.
3. `tables`
   - CRUD + delete-impact checks.
4. `products`
   - Includes image metadata, combo aggregation, delete side effects.
5. `orders`
   - Most complex business logic, transaction-heavy.
6. `reports`
   - Heavy aggregations and JSON SQL constructs.

For each module:

1. Replace PG-only syntax:
   - `ILIKE` -> normalized `LIKE` strategy.
   - `ANY($1::text[])` -> dynamic `IN (...)` placeholders.
   - `::text`, `::timestamptz`, enum casts -> SQLite equivalents.
2. Replace PG JSON aggregation:
   - `JSON_AGG/JSON_BUILD_OBJECT` -> SQLite JSON functions or app-level aggregation.
3. Normalize date filtering logic.
   - Store ISO-8601 UTC text, compare lexicographically.
4. Keep response shape unchanged.

Deliverables:
- Module parity checklist completed one by one.
- No API schema drift.

---

## Phase 4 - Feature flags and fallback

1. Add runtime flag to fail fast on unsupported queries.
   - Example: `SQLITE_STRICT_MODE=true`.
2. Keep fallback path.
   - Can run same commit against Postgres for comparison.
3. Add dual-run test mode in CI.
   - Run integration suite once on PG and once on SQLite.

Deliverables:
- CI matrix for `postgres` and `sqlite`
- Clear unsupported-feature logs if encountered

---

## Phase 5 - Verification and performance on small VM

1. Data correctness tests.
   - Order totals, discount/surcharge math, state transitions.
2. Concurrency tests.
   - Parallel order create/update operations.
3. Performance sanity for expected load.
   - 10-20 ops/min target on 2 vCPU/2GB.
4. Backup/restore rehearsal.
   - SQLite file backup strategy and restore validation.

Deliverables:
- `docs/sqlite/verification-report.md`
- Go/no-go decision for production usage

---

## Phase 6 - Cutover strategy

1. Choose deployment model:
   - A) full cutover to SQLite, or
   - B) keep PG in prod, SQLite for constrained/self-hosted installs.
2. If full cutover, run one-time migration export/import.
3. Monitor first week:
   - API error rate
   - Order lifecycle anomalies
   - Report mismatches

Deliverables:
- Cutover runbook
- Rollback runbook to Postgres

---

## Estimated effort

- Minimal "runs locally on SQLite" (partial parity): 3-5 days.
- High-confidence parity (including reports and edge behavior): 2-4 weeks.

## Recommendation

- Start with a dual-dialect architecture, not a hard replace.
- Prioritize correctness in `orders` and `reports`; those are the highest risk.
