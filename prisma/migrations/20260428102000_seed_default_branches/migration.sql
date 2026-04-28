-- Seed 5 default branches for initial POS setup
WITH seed_branches (id, name) AS (
  VALUES
    ('default-branch-1', 'Chi nhánh 1'),
    ('default-branch-2', 'Chi nhánh 2'),
    ('default-branch-3', 'Chi nhánh 3'),
    ('default-branch-4', 'Chi nhánh 4'),
    ('default-branch-5', 'Chi nhánh 5')
)
INSERT INTO "branches" ("id", "name", "address", "phone", "isActive", "createdAt", "updatedAt")
SELECT sb.id, sb.name, NULL, NULL, true, NOW(), NOW()
FROM seed_branches sb
WHERE NOT EXISTS (
  SELECT 1
  FROM "branches" b
  WHERE LOWER(b."name") = LOWER(sb.name)
);
