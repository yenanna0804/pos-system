import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;
const preferredBranchId = process.env.BRANCH_ID || null;

if (!databaseUrl) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const comboCategoryName = 'Combo Wine';

const combos = [
  { sku: 'CMW001', name: 'Combo Jagermeister', price: 2399000, baseSku: 'WINE003' },
  { sku: 'CMW002', name: "Combo Jacob’s Sparklink", price: 2599000, baseSku: 'WINE015' },
  { sku: 'CMW003', name: 'Combo Chivas 12', price: 2599000, baseSku: 'WINE005' },
  { sku: 'CMW004', name: 'Combo Chivas 15', price: 3299000, baseSku: 'WINE006' },
  { sku: 'CMW005', name: 'Combo Chivas 18', price: 3999000, baseSku: 'WINE007' },
  { sku: 'CMW006', name: 'Combo Chivas 21', price: 4999000, baseSku: 'WINE008' },
  { sku: 'CMW007', name: 'Combo Ballantines Finet', price: 2499000, baseSku: 'WINE009' },
  { sku: 'CMW008', name: 'Combo Ballantines 17', price: 3499000, baseSku: 'WINE010' },
  { sku: 'CMW009', name: 'Combo Ballantines 21', price: 4299000, baseSku: 'WINE011' },
  { sku: 'CMW010', name: 'Combo Champagne Veuve Clicquot Rose', price: 4899000, baseSku: 'WINE016' },
  { sku: 'CMW011', name: 'Combo Macallan 12', price: 4999000, baseSku: 'WINE012' },
  { sku: 'CMW012', name: 'Combo Macallan 15', price: 11299000, baseSku: 'WINE013' },
];

const commonItems = [
  { sku: 'SRV002', quantity: 1 },
  { sku: 'SRV004', quantity: 1 },
  { sku: 'DRK002', quantity: 2 },
  { sku: 'DRK001', quantity: 2 },
  { sku: 'SRV010', quantity: 5 },
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

async function ensureWine015(client, branchId) {
  const sku = 'WINE015';
  const name = "Jacob’s Sparklink";
  const unit = 'Chai';

  const existed = await client.query('SELECT id FROM products WHERE sku = $1 LIMIT 1', [sku]);
  const productId = existed.rows[0]?.id || randomUUID();

  if (!existed.rows[0]) {
    await client.query(
      `INSERT INTO products
       (id, name, sku, "type", "autoPrice", price, "costPrice", unit, weight, stock, "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'SINGLE', false, 0, 0, $4, 0, 0, true, NOW(), NOW())`,
      [productId, name, sku, unit],
    );
  } else {
    await client.query(
      'UPDATE products SET name = $1, unit = $2, "deletedAt" = NULL, "isActive" = true, "updatedAt" = NOW() WHERE id = $3',
      [name, unit, productId],
    );
  }

  const pb = await client.query(
    'SELECT id FROM product_branches WHERE "productId" = $1 AND "branchId" = $2 LIMIT 1',
    [productId, branchId],
  );
  if (!pb.rows[0]) {
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
  const resolvedItems = [];
  const base = productMap.get(combo.baseSku);
  if (!base) throw new Error(`Missing base product SKU: ${combo.baseSku}`);
  if (base.type === 'COMBO') throw new Error(`Base SKU cannot be COMBO: ${combo.baseSku}`);
  resolvedItems.push({ itemProductId: base.id, quantity: 1 });

  for (const item of commonItems) {
    const row = productMap.get(item.sku);
    if (!row) throw new Error(`Missing component SKU: ${item.sku} for combo ${combo.sku}`);
    if (row.type === 'COMBO') throw new Error(`Component cannot be COMBO: ${item.sku}`);
    resolvedItems.push({ itemProductId: row.id, quantity: item.quantity });
  }

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
  for (const item of resolvedItems) {
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

    await ensureWine015(client, branchId);
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
