# Migration Architecture Guide

This document defines how we manage Prisma migrations for long-term scale and maintainability, with focus on naming conflicts and schema evolution in Orders and Room/Table relationships.

## Goals

- Keep all schema changes in migrations, never in runtime service code.
- Maintain one canonical schema naming model across Prisma schema, SQL, and application code.
- Make migrations additive, idempotent where needed, and safe for production deploys.
- Prevent lock contention by running migrations in a single dedicated deploy job.

## Current Migration Timeline

### Foundation

- `20260427164612_init`
  - Initial schema with `orders.taxAmount`, `orders.status`, `orders.paymentStatus`.
- `20260427165206_add_branches`
  - Added `branches` and `branchId` relations.

### Product + Inventory

- `20260428091000_product_branch_inventory`
  - Added inventory and soft-delete related fields.
  - Introduced `product_branches`.

### Orders Domain Evolution

- `20260429193000_orders_design_system`
  - Introduced `OrderLifecycleState` and `OrderLogAction` enums.
  - Added `orders.orderState`, `orders.orderCode`, `orders.paidAmount`, `orders.customerName`.
  - Created `order_logs`.
- `20260429203000_drop_orders_billitems`
  - Removed legacy `orders.billItems` JSONB column.
- `20260430090000_orders_single_state_orderstate`
  - Migrated from legacy `status/paymentStatus` to single `orderState`.
  - Dropped legacy columns and enum types.

### Runtime DDL Removal (Hardening)

- `20260430100000_move_runtime_ddl_to_migration`
  - Moved DDL from runtime `seed.ts` into migration.
  - Added `areas`, `rooms`, `tables.areaId`, `tables.roomId` and related FKs.
- `20260430114000_orders_schema_alignment`
  - Aligned Orders schema with service contract.
  - Renamed `taxAmount` -> `surchargeAmount` (guarded).
  - Added `orders.roomId` FK to `rooms`.
  - Added `order_items.baseUnitPrice` and backfilled.

## Canonical Naming Model (Source of Truth)

Use these names consistently in DB, Prisma schema, and service code:

- `orders.orderState` (enum `OrderLifecycleState`) is the only lifecycle state field.
- `orders.surchargeAmount` is canonical; do not use `taxAmount` anymore.
- `orders.roomId` is the room-level relation for ROOM orders.
- `tables.roomId` and `tables.areaId` define physical placement model.
- `order_items.baseUnitPrice` stores baseline pricing for discount/surcharge calculations.

## Migration Rules (Team Policy)

- No runtime schema writes:
  - Do not run `ALTER TABLE`, `CREATE TABLE`, `DROP TABLE`, enum changes, or FK/index creation in service/bootstrap/seed runtime paths.
- Migrations only:
  - Every schema change must be introduced via a new migration directory under `prisma/migrations`.
- Compatibility-first rollout:
  - For breaking renames, use staged migrations:
    1) Add new column
    2) Backfill
    3) Switch app reads/writes
    4) Drop old column in later migration
- Safe DDL style:
  - Prefer `IF NOT EXISTS` / guarded `DO $$` checks for legacy environments.
- Data migrations must be explicit:
  - Include deterministic backfill queries in the same migration when changing semantics.

## Deploy Topology

- Render start command must only start app process.
- Run `prisma migrate deploy` in one dedicated migration job before web rollout.
- Never run migrate in multiple replicas simultaneously.

## Known Overlap Cleanup Status

- `taxAmount` vs `surchargeAmount`
  - Status: canonicalized to `surchargeAmount` via `20260430114000_orders_schema_alignment`.
  - Action: no new code may reference `taxAmount`.
- Room/Table relationship
  - Status: moved from runtime DDL to migration history via `20260430100000_move_runtime_ddl_to_migration` and `20260430114000_orders_schema_alignment`.
  - Action: all FK assumptions must rely on migrations, not service guards.

## PR Checklist For Any Schema Change

- [ ] Prisma schema updated (`prisma/schema.prisma`).
- [ ] New migration created and reviewed for both DDL and data backfill.
- [ ] Service code uses canonical names only.
- [ ] No runtime DDL added in app bootstrap/service/seed path.
- [ ] Rollout order documented (migrate job first, app deploy second).
- [ ] Backward-compatibility impact assessed for existing rows.

## Next Hardening Steps

- Add CI gate that rejects `ALTER/CREATE/DROP` SQL strings inside `src/**`.
- Add a migration review template to PRs for enum/rename changes.
- Optionally split seed-data migrations from schema migrations by environment policy.
