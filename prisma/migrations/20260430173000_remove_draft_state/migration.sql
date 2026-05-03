-- Remove DRAFT lifecycle state and CREATE_DRAFT action.
-- Keep existing rows by mapping old values to supported values.

UPDATE orders
SET "orderState" = 'PARTIAL'
WHERE "orderState"::text = 'DRAFT';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderLifecycleState_old') THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name = 'orderState' AND udt_name = 'OrderLifecycleState_old'
    ) THEN
      ALTER TABLE orders
        ALTER COLUMN "orderState" DROP DEFAULT,
        ALTER COLUMN "orderState" TYPE "OrderLifecycleState"
        USING ("orderState"::text::"OrderLifecycleState");
      ALTER TABLE orders
        ALTER COLUMN "orderState" SET DEFAULT 'PARTIAL'::"OrderLifecycleState";
    END IF;
    DROP TYPE "OrderLifecycleState_old";
  ELSIF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderLifecycleState') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderLifecycleState_old') THEN
      ALTER TYPE "OrderLifecycleState" RENAME TO "OrderLifecycleState_old";
      CREATE TYPE "OrderLifecycleState" AS ENUM ('PARTIAL', 'PAID', 'DELETED');
      ALTER TABLE orders
        ALTER COLUMN "orderState" DROP DEFAULT,
        ALTER COLUMN "orderState" TYPE "OrderLifecycleState"
        USING ("orderState"::text::"OrderLifecycleState");
      ALTER TABLE orders
        ALTER COLUMN "orderState" SET DEFAULT 'PARTIAL'::"OrderLifecycleState";
      DROP TYPE "OrderLifecycleState_old";
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderLogAction_old') THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'order_logs' AND column_name = 'action' AND udt_name = 'OrderLogAction_old'
    ) THEN
      ALTER TABLE order_logs
        ALTER COLUMN action TYPE "OrderLogAction"
        USING (
          CASE
            WHEN action::text IN ('CREATE_DRAFT', 'CREATE') THEN 'CREATE_ORDER'
            ELSE action::text
          END::"OrderLogAction"
        );
    END IF;
    DROP TYPE "OrderLogAction_old";
  ELSIF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderLogAction') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderLogAction_old') THEN
      ALTER TYPE "OrderLogAction" RENAME TO "OrderLogAction_old";
      CREATE TYPE "OrderLogAction" AS ENUM ('CREATE_ORDER', 'UPDATE_ORDER', 'PRINT_ORDER', 'DELETE_ORDER', 'PAY_PARTIAL', 'PAY_FULL');
      ALTER TABLE order_logs
        ALTER COLUMN action TYPE "OrderLogAction"
        USING (
          CASE
            WHEN action::text IN ('CREATE_DRAFT', 'CREATE') THEN 'CREATE_ORDER'
            ELSE action::text
          END::"OrderLogAction"
        );
      DROP TYPE "OrderLogAction_old";
    END IF;
  END IF;
END $$;
