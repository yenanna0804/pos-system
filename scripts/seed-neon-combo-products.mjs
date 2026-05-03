import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;
const preferredBranchId = process.env.BRANCH_ID || null;

if (!databaseUrl) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const comboCategoryName = 'Combo';

const combos = [
  {
    sku: 'CMB001',
    name: 'Combo Mini',
    price: 399000,
    items: [
      { sku: 'DRK004', quantity: 3 },
      { sku: 'SRV002', quantity: 1 },
      { sku: 'DRK001', quantity: 1 },
    ],
  },
  {
    sku: 'CMB002',
    name: 'Combo Tiger',
    price: 999000,
    items: [
      { sku: 'DRK004', quantity: 8 },
      { sku: 'SRV002', quantity: 1 },
      { sku: 'DRK001', quantity: 2 },
      { sku: 'SRV010', quantity: 3 },
    ],
  },
  {
    sku: 'CMB003',
    name: 'Combo Heniken',
    price: 999000,
    items: [
      { sku: 'DRK005', quantity: 8 },
      { sku: 'SRV002', quantity: 1 },
      { sku: 'DRK001', quantity: 2 },
      { sku: 'SRV010', quantity: 3 },
    ],
  },
  {
    sku: 'CMB004',
    name: 'Combo Rượu Mix',
    price: 999000,
    items: [
      { sku: 'WINE002', quantity: 1 },
      { sku: 'SRV002', quantity: 1 },
      { sku: 'DRK001', quantity: 2 },
      { sku: 'SRV010', quantity: 3 },
    ],
  },
  {
    sku: 'CMB005',
    name: 'Combo Budweiser',
    price: 1399000,
    items: [
      { sku: 'DRK007', quantity: 8 },
      { sku: 'SRV002', quantity: 1 },
      { sku: 'DRK001', quantity: 2 },
      { sku: 'SRV010', quantity: 3 },
    ],
  },
  {
    sku: 'CMB006',
    name: 'Combo Corona',
    price: 1399000,
    items: [
      { sku: 'DRK006', quantity: 8 },
      { sku: 'SRV002', quantity: 1 },
      { sku: 'DRK001', quantity: 2 },
      { sku: 'SRV010', quantity: 3 },
    ],
  },
  {
    sku: 'CMB007',
    name: 'Combo Sinh Nhật',
    price: 2799000,
    items: [
      { sku: 'SRV011', quantity: 1 },
      { sku: 'WINE005', quantity: 1 },
      { sku: 'SRV002', quantity: 1 },
      { sku: 'DRK002', quantity: 2 },
      { sku: 'SRV010', quantity: 3 },
    ],
  },
];

async function ensureCategory(client, name) {
  const existed = await client.query(
    'SELECT id FROM categories WHERE LOWER(name) = LOWER($1) AND "deletedAt" IS NULL LIMIT 1',
    [name],
  );
  if (existed.rows[0]) return existed.rows[0].id;

  const id = randomUUID();
  await client.query(
    'INSERT INTO categories (id, name, "sortOrder", "isActive", "createdAt", "updatedAt") VALUES ($1, $2, 0, true, NOW(), NOW())',
    [id, name],
  );
  return id;
}

async function resolveBranchId(client) {
  if (preferredBranchId) {
    const existed = await client.query(
      'SELECT id FROM branches WHERE id = $1 AND "isActive" = true LIMIT 1',
      [preferredBranchId],
    );
    if (!existed.rows[0]) {
      throw new Error(`BRANCH_ID not found or inactive: ${preferredBranchId}`);
    }
    return preferredBranchId;
  }

  const rows = await client.query('SELECT id FROM branches WHERE "isActive" = true ORDER BY "createdAt" ASC LIMIT 1');
  if (!rows.rows[0]) throw new Error('No active branch found.');
  return rows.rows[0].id;
}

async function ensureBirthdayCakeProduct(client, branchId) {
  const sku = 'SRV011';
  const name = 'Bánh Sinh Nhật';
  const unit = 'Phần';
  const price = 0;

  const existed = await client.query('SELECT id FROM products WHERE sku = $1 LIMIT 1', [sku]);
  const productId = existed.rows[0]?.id || randomUUID();

  if (!existed.rows[0]) {
    await client.query(
      `INSERT INTO products
       (id, name, sku, "type", "autoPrice", price, "costPrice", unit, weight, stock, "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'SINGLE', false, $4, 0, $5, 0, 0, true, NOW(), NOW())`,
      [productId, name, sku, price, unit],
    );
  } else {
    await client.query(
      `UPDATE products
       SET name = $1, unit = $2, "deletedAt" = NULL, "isActive" = true, "updatedAt" = NOW()
       WHERE id = $3`,
      [name, unit, productId],
    );
  }

  const pb = await client.query(
    'SELECT id FROM product_branches WHERE "productId" = $1 AND "branchId" = $2 LIMIT 1',
    [productId, branchId],
  );
  if (pb.rows[0]) {
    await client.query('UPDATE product_branches SET "isActive" = true, "updatedAt" = NOW() WHERE id = $1', [pb.rows[0].id]);
  } else {
    await client.query(
      'INSERT INTO product_branches (id, "productId", "branchId", "isActive", stock, "createdAt", "updatedAt") VALUES ($1, $2, $3, true, 0, NOW(), NOW())',
      [randomUUID(), productId, branchId],
    );
  }
}

async function mapProductIdsBySku(client) {
  const rows = await client.query('SELECT id, sku, "type" FROM products WHERE sku IS NOT NULL AND "deletedAt" IS NULL');
  const map = new Map();
  for (const row of rows.rows) map.set(row.sku, row);
  return map;
}

async function upsertCombo(client, combo, categoryId, branchId, productMap) {
  const itemRows = combo.items.map((item) => {
    const row = productMap.get(item.sku);
    if (!row) throw new Error(`Missing component SKU: ${item.sku} for combo ${combo.sku}`);
    if (row.type === 'COMBO') throw new Error(`Component ${item.sku} cannot be COMBO`);
    return { itemProductId: row.id, quantity: item.quantity };
  });

  const existed = await client.query('SELECT id FROM products WHERE sku = $1 LIMIT 1', [combo.sku]);
  let comboId = existed.rows[0]?.id;
  let action = 'updated';

  if (!comboId) {
    comboId = randomUUID();
    action = 'created';
    await client.query(
      `INSERT INTO products
       (id, name, sku, "type", "autoPrice", price, "costPrice", "categoryId", unit, weight, stock, "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'COMBO', false, $4, 0, $5, 'Combo', 0, 0, true, NOW(), NOW())`,
      [comboId, combo.name, combo.sku, combo.price, categoryId],
    );
  } else {
    await client.query(
      `UPDATE products
       SET name = $1,
           "type" = 'COMBO',
           "autoPrice" = false,
           price = $2,
           "costPrice" = 0,
           "categoryId" = $3,
           unit = 'Combo',
           weight = 0,
           "isActive" = true,
           "deletedAt" = NULL,
           "updatedAt" = NOW()
       WHERE id = $4`,
      [combo.name, combo.price, categoryId, comboId],
    );
  }

  await client.query('DELETE FROM product_combo_items WHERE "comboProductId" = $1', [comboId]);
  for (const item of itemRows) {
    await client.query(
      `INSERT INTO product_combo_items (id, "comboProductId", "itemProductId", quantity, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [randomUUID(), comboId, item.itemProductId, item.quantity],
    );
  }

  const pb = await client.query(
    'SELECT id FROM product_branches WHERE "productId" = $1 AND "branchId" = $2 LIMIT 1',
    [comboId, branchId],
  );
  if (pb.rows[0]) {
    await client.query('UPDATE product_branches SET "isActive" = true, stock = 0, "updatedAt" = NOW() WHERE id = $1', [pb.rows[0].id]);
  } else {
    await client.query(
      'INSERT INTO product_branches (id, "productId", "branchId", "isActive", stock, "createdAt", "updatedAt") VALUES ($1, $2, $3, true, 0, NOW(), NOW())',
      [randomUUID(), comboId, branchId],
    );
  }

  return action;
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');

    const branchId = await resolveBranchId(client);
    const categoryId = await ensureCategory(client, comboCategoryName);
    await ensureBirthdayCakeProduct(client, branchId);

    const productMap = await mapProductIdsBySku(client);
    let created = 0;
    let updated = 0;

    for (const combo of combos) {
      const action = await upsertCombo(client, combo, categoryId, branchId, productMap);
      if (action === 'created') created += 1;
      if (action === 'updated') updated += 1;
    }

    await client.query('COMMIT');
    console.log(`Done. Branch: ${branchId}, Combo created: ${created}, Combo updated: ${updated}, Total combos: ${combos.length}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
