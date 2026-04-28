-- Seed default admin login for POS demo
WITH target_branch AS (
  SELECT id
  FROM "branches"
  WHERE LOWER(name) = LOWER('Chi nhánh 1')
  LIMIT 1
)
INSERT INTO "users" (
  "id",
  "username",
  "password",
  "fullName",
  "email",
  "role",
  "branchId",
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  'admin-user-default',
  'admin',
  '$2b$10$kM0PDghOEJkyyV.6QpYXu.OUEn0UfYWG2j5ligapk77QyVbE/pzia',
  'Quản trị viên',
  NULL,
  'ADMIN'::"UserRole",
  tb.id,
  true,
  NOW(),
  NOW()
FROM target_branch tb
ON CONFLICT ("username") DO UPDATE
SET
  "password" = EXCLUDED."password",
  "fullName" = EXCLUDED."fullName",
  "role" = EXCLUDED."role",
  "branchId" = EXCLUDED."branchId",
  "isActive" = true,
  "updatedAt" = NOW();
