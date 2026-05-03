DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'OrderLifecycleState' AND e.enumlabel = 'DRAFT'
  ) THEN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderLifecycleState') THEN
      ALTER TYPE "OrderLifecycleState" RENAME TO "OrderLifecycleState_old";
    END IF;

    CREATE TYPE "OrderLifecycleState" AS ENUM ('DRAFT', 'PARTIAL', 'PAID', 'DELETED');

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name = 'orderState'
    ) THEN
      ALTER TABLE orders
        ALTER COLUMN "orderState" DROP DEFAULT,
        ALTER COLUMN "orderState" TYPE "OrderLifecycleState"
        USING ("orderState"::text::"OrderLifecycleState"),
        ALTER COLUMN "orderState" SET DEFAULT 'PARTIAL'::"OrderLifecycleState";
    END IF;

    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderLifecycleState_old') THEN
      DROP TYPE "OrderLifecycleState_old";
    END IF;
  END IF;
END $$;
