import { execSync } from 'child_process';
import { Client } from 'pg';

const REQUIRED_ORDER_COLUMNS = [
  'discountMode',
  'discountValue',
  'surchargeMode',
  'surchargeValue',
] as const;

export async function assertOrdersAdjustmentSchema() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const rows = await client.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'orders'
         AND column_name = ANY($1::text[])`,
      [REQUIRED_ORDER_COLUMNS],
    );
    const found = new Set(rows.rows.map((row) => row.column_name));
    const missing = REQUIRED_ORDER_COLUMNS.filter((columnName) => !found.has(columnName));
    if (missing.length > 0) {
      throw new Error(`Schema check failed. Missing orders columns: ${missing.join(', ')}`);
    }
  } finally {
    await client.end();
  }
}

export function runMigrationsOrFail() {
  execSync('npm run migrate:deploy', {
    stdio: 'inherit',
    env: process.env,
  });
}
