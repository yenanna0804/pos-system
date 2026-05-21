DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'OrderLifecycleState'
      AND e.enumlabel = 'PAYING'
  ) THEN
    ALTER TYPE "OrderLifecycleState" ADD VALUE 'PAYING' AFTER 'DRAFT';
  END IF;
END $$;
