import { randomUUID } from 'crypto';
import { PgService } from './pg.service';
import * as bcrypt from 'bcryptjs';

type BranchRow = { id: string };

export async function seed(db: PgService) {
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
