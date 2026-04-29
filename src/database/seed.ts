import { randomUUID } from 'crypto';
import { PgService } from './pg.service';
import * as bcrypt from 'bcryptjs';

type BranchRow = { id: string };

export async function seed(db: PgService) {
  await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS unit text');
  await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS weight numeric(12,3)');
  await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS stock numeric(12,3) DEFAULT 0');
  await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS "deletedAt" timestamp(3)');
  await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS "imageThumb" text');
  await db.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS \"type\" text DEFAULT 'SINGLE'");
  await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS "autoPrice" boolean DEFAULT true');
  await db.query('ALTER TABLE categories ADD COLUMN IF NOT EXISTS "deletedAt" timestamp(3)');
  await db.query('ALTER TABLE tables ADD COLUMN IF NOT EXISTS "areaId" text');
  await db.query('ALTER TABLE tables ADD COLUMN IF NOT EXISTS "roomId" text');
  await db.query('ALTER TABLE tables ADD COLUMN IF NOT EXISTS "deletedAt" timestamp(3)');

  await db.query('DROP TABLE IF EXISTS order_draft_logs');
  await db.query('DROP TABLE IF EXISTS order_drafts');

  await db.query(`
    CREATE TABLE IF NOT EXISTS areas (
      id text PRIMARY KEY,
      name text NOT NULL,
      "branchId" text REFERENCES branches(id) ON DELETE SET NULL,
      "deletedAt" timestamp(3),
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id text PRIMARY KEY,
      name text NOT NULL,
      "areaId" text NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
      "branchId" text REFERENCES branches(id) ON DELETE SET NULL,
      "deletedAt" timestamp(3),
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tables_areaId_fkey') THEN
        ALTER TABLE tables
          ADD CONSTRAINT "tables_areaId_fkey"
          FOREIGN KEY ("areaId") REFERENCES areas(id) ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
    END $$;
  `);

  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tables_roomId_fkey') THEN
        ALTER TABLE tables
          ADD CONSTRAINT "tables_roomId_fkey"
          FOREIGN KEY ("roomId") REFERENCES rooms(id) ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
    END $$;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS product_branches (
      id text PRIMARY KEY,
      "productId" text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      "branchId" text NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      "isActive" boolean NOT NULL DEFAULT true,
      stock numeric(12,3) NOT NULL DEFAULT 0,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("productId", "branchId")
    )
  `);
  await db.query('ALTER TABLE product_branches ADD COLUMN IF NOT EXISTS stock numeric(12,3) NOT NULL DEFAULT 0');

  await db.query(`
    CREATE TABLE IF NOT EXISTS product_combo_items (
      id text PRIMARY KEY,
      "comboProductId" text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      "itemProductId" text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      quantity int NOT NULL,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("comboProductId", "itemProductId")
    )
  `);

  if (process.env.ENABLE_DEV_SEED !== 'true') {
    return;
  }

  const seedBranchName = process.env.SEED_BRANCH_NAME;
  const seedAdminUsername = process.env.SEED_ADMIN_USERNAME;
  const seedAdminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!seedBranchName || !seedAdminUsername || !seedAdminPassword) {
    return;
  }

  const password = await bcrypt.hash(seedAdminPassword, 10);

  const existedBranches = await db.query<BranchRow>(
    'SELECT id FROM branches WHERE name = $1 LIMIT 1',
    [seedBranchName],
  );

  const branchId = existedBranches[0]?.id ?? randomUUID();

  if (!existedBranches[0]) {
    await db.query(
      `INSERT INTO branches (id, name, address, phone, "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [
        branchId,
        seedBranchName,
        process.env.SEED_BRANCH_ADDRESS || '',
        process.env.SEED_BRANCH_PHONE || '',
        true,
      ],
    );
  }

  await db.query(
    `INSERT INTO users (id, username, password, "fullName", email, role, "branchId", "isActive", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, CAST($6 AS "UserRole"), $7, $8, NOW(), NOW())
     ON CONFLICT (username) DO NOTHING`,
    [
      randomUUID(),
      seedAdminUsername,
      password,
      process.env.SEED_ADMIN_FULLNAME || null,
      process.env.SEED_ADMIN_EMAIL || null,
      'ADMIN',
      branchId,
      true,
    ],
  );
}
