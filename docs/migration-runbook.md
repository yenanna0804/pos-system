# Migration Runbook (Render + Prisma)

## Goal

Deploy safely with a two-phase flow:

1. Run DB migration first.
2. Start application only after migration succeeds.

Application startup must never auto-repair or auto-resolve failed migrations.

## Render configuration

- Build Command: `npm install && npm run build`
- Start Command: `npm run start:prod`
- Release Command: `npm run render:release`

`start:prod` only starts the app process. Migrations run exclusively in release phase.

## Pre-deploy checklist

1. Confirm `DATABASE_URL` points to the target environment.
2. Confirm new migration files are committed.
3. Confirm backend build passes locally.

## Normal deploy flow

1. Trigger deploy.
2. Render executes release command `npm run render:release`.
3. If release succeeds, app starts with `npm run start:prod`.
4. Verify health endpoint:
   - `GET /api/health/schema`
   - Expected: `ok: true`

## Incident: Prisma P3009 failed migration

Symptom:

- Release fails with `P3009` and a specific migration name in `_prisma_migrations`.

Manual recovery steps:

1. Resolve failed migration as rolled back:

   ```bash
   npx prisma migrate resolve --rolled-back <migration_name>
   ```

2. Re-run migration deploy:

   ```bash
   npm run migrate:deploy
   ```

3. Re-trigger deploy.

### Special case in this project

If the failed migration is `20260430173000_remove_draft_state`, use helper command:

```bash
npm run migrate:repair:remove-draft-state
```

Then run:

```bash
npm run migrate:deploy
```

## Post-deploy validation

1. `GET /api/health/schema` returns `ok: true`.
2. Orders flow smoke test:
   - Open order edit.
   - Save with `%` discount/surcharge.
   - Re-open and verify mode/value are preserved.

## Rules

- Never add `migrate resolve` into `start` scripts.
- Never add `migrate deploy` into `start` scripts.
- Keep migration recovery as explicit manual operation with audit trail.
