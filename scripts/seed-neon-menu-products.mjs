import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;
const preferredBranchId = process.env.BRANCH_ID || null;

if (!databaseUrl) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const categoryNames = ['Western Wine', 'Cocktail', 'Beer & Drink', 'Service'];

const products = [
  { sku: 'WINE001', name: 'Rượu mix vị hoa quả', price: 699000, unit: 'Chai', categoryName: 'Western Wine' },
  { sku: 'WINE002', name: 'Rượu mix', price: 799000, unit: 'Chai', categoryName: 'Western Wine' },
  { sku: 'WINE003', name: 'Jagermeister', price: 1799000, unit: 'Chai', categoryName: 'Western Wine' },
  { sku: 'WINE004', name: 'Rượu vang F', price: 1899000, unit: 'Chai', categoryName: 'Western Wine' },
  { sku: 'WINE005', name: 'Chivas 12', price: 2099000, unit: 'Chai', categoryName: 'Western Wine' },
  { sku: 'WINE006', name: 'Chivas 15', price: 2599000, unit: 'Chai', categoryName: 'Western Wine' },
  { sku: 'WINE007', name: 'Chivas 18', price: 3099000, unit: 'Chai', categoryName: 'Western Wine' },
  { sku: 'WINE008', name: 'Chivas 21', price: 4099000, unit: 'Chai', categoryName: 'Western Wine' },
  { sku: 'WINE009', name: 'Ballantines Finet', price: 1799000, unit: 'Chai', categoryName: 'Western Wine' },
  { sku: 'WINE010', name: 'Ballantines 17', price: 2799000, unit: 'Chai', categoryName: 'Western Wine' },
  { sku: 'WINE011', name: 'Ballantines 21', price: 3399000, unit: 'Chai', categoryName: 'Western Wine' },
  { sku: 'WINE012', name: 'Macalan 12', price: 4099000, unit: 'Chai', categoryName: 'Western Wine' },
  { sku: 'WINE013', name: 'Macalan 15', price: 9700000, unit: 'Chai', categoryName: 'Western Wine' },
  { sku: 'WINE014', name: 'Cham pagne', price: 2099000, unit: 'Chai', categoryName: 'Western Wine' },
  { sku: 'WINE016', name: 'Champagne Veuve Clicquot Rose', price: 4299000, unit: 'Chai', categoryName: 'Western Wine' },
  { sku: 'CKT001', name: 'Phoenix', price: 99000, unit: 'Ly', categoryName: 'Cocktail' },
  { sku: 'CKT002', name: 'Pico Pico', price: 229000, unit: 'Ly', categoryName: 'Cocktail' },
  { sku: 'CKT003', name: 'Pink Lady', price: 229000, unit: 'Ly', categoryName: 'Cocktail' },
  { sku: 'CKT004', name: 'Vitamin Sea', price: 229000, unit: 'Ly', categoryName: 'Cocktail' },
  { sku: 'DRK001', name: 'Dasani', price: 35000, unit: 'Lon/Chai', categoryName: 'Beer & Drink' },
  { sku: 'DRK002', name: 'Coca Cola', price: 55000, unit: 'Lon/Chai', categoryName: 'Beer & Drink' },
  { sku: 'DRK003', name: 'Redbull', price: 65000, unit: 'Lon/Chai', categoryName: 'Beer & Drink' },
  { sku: 'DRK004', name: 'Beer Tiger', price: 89000, unit: 'Lon/Chai', categoryName: 'Beer & Drink' },
  { sku: 'DRK005', name: 'Beer Heniken', price: 89000, unit: 'Lon/Chai', categoryName: 'Beer & Drink' },
  { sku: 'DRK006', name: 'Beer Corona', price: 105000, unit: 'Lon/Chai', categoryName: 'Beer & Drink' },
  { sku: 'DRK007', name: 'Beer Budweiser', price: 139000, unit: 'Lon/Chai', categoryName: 'Beer & Drink' },
  { sku: 'SRV001', name: 'Hoa quả', price: 199000, unit: 'Phần', categoryName: 'Service' },
  { sku: 'SRV002', name: 'Trái cây vip', price: 399000, unit: 'Phần', categoryName: 'Service' },
  { sku: 'SRV003', name: 'Phô mai dây Nga', price: 199000, unit: 'Phần', categoryName: 'Service' },
  { sku: 'SRV004', name: 'Trâu gác bếp Tây Bắc', price: 199000, unit: 'Phần', categoryName: 'Service' },
  { sku: 'SRV005', name: 'Bò gác bếp Tây Bắc', price: 179000, unit: 'Phần', categoryName: 'Service' },
  { sku: 'SRV006', name: 'Snack', price: 129000, unit: 'Phần', categoryName: 'Service' },
  { sku: 'SRV007', name: 'Thuốc lá Thăng Long', price: 39000, unit: 'Bao', categoryName: 'Service' },
  { sku: 'SRV008', name: 'Thuốc lá Ken, 555, Camel', price: 89000, unit: 'Bao', categoryName: 'Service' },
  { sku: 'SRV009', name: 'Thuốc lá Man, Vina, Ngựa', price: 79000, unit: 'Bao', categoryName: 'Service' },
  { sku: 'SRV010', name: 'Khăn lạnh', price: 8000, unit: 'Cái', categoryName: 'Service' },
];

async function ensureCategories(client) {
  const categoryByName = new Map();
  for (const name of categoryNames) {
    const existed = await client.query(
      'SELECT id FROM categories WHERE LOWER(name) = LOWER($1) AND "deletedAt" IS NULL LIMIT 1',
      [name],
    );
    if (existed.rows[0]) {
      categoryByName.set(name, existed.rows[0].id);
      continue;
    }
    const createdId = randomUUID();
    await client.query(
      'INSERT INTO categories (id, name, "sortOrder", "isActive", "createdAt", "updatedAt") VALUES ($1, $2, 0, true, NOW(), NOW())',
      [createdId, name],
    );
    categoryByName.set(name, createdId);
  }
  return categoryByName;
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
  if (!rows.rows[0]) {
    throw new Error('No active branch found. Create a branch first.');
  }
  return rows.rows[0].id;
}

async function upsertProduct(client, product, categoryId, branchId) {
  const existed = await client.query('SELECT id FROM products WHERE sku = $1 LIMIT 1', [product.sku]);
  let productId = existed.rows[0]?.id;
  let action = 'updated';

  if (!productId) {
    productId = randomUUID();
    action = 'created';
    await client.query(
      `INSERT INTO products
       (id, name, sku, "type", "autoPrice", price, "costPrice", "categoryId", unit, weight, stock, "isActive", "timeRateAmount", "timeRateMinutes", "createdAt", "updatedAt", "imageUrl", "imageThumb")
       VALUES ($1, $2, $3, 'SINGLE', false, $4, 0, $5, $6, 0, 0, true, NULL, NULL, NOW(), NOW(), NULL, NULL)`,
      [productId, product.name, product.sku, product.price, categoryId, product.unit],
    );
  } else {
    await client.query(
      `UPDATE products
       SET name = $1,
           "type" = 'SINGLE',
           "autoPrice" = false,
           price = $2,
           "costPrice" = 0,
           "categoryId" = $3,
           unit = $4,
           weight = 0,
           "isActive" = true,
           "timeRateAmount" = NULL,
           "timeRateMinutes" = NULL,
           "deletedAt" = NULL,
           "updatedAt" = NOW()
       WHERE id = $5`,
      [product.name, product.price, categoryId, product.unit, productId],
    );
  }

  const pb = await client.query(
    'SELECT id FROM product_branches WHERE "productId" = $1 AND "branchId" = $2 LIMIT 1',
    [productId, branchId],
  );
  if (pb.rows[0]) {
    await client.query(
      'UPDATE product_branches SET "isActive" = true, stock = 0, "updatedAt" = NOW() WHERE id = $1',
      [pb.rows[0].id],
    );
  } else {
    await client.query(
      'INSERT INTO product_branches (id, "productId", "branchId", "isActive", stock, "createdAt", "updatedAt") VALUES ($1, $2, $3, true, 0, NOW(), NOW())',
      [randomUUID(), productId, branchId],
    );
  }

  return action;
}

async function syncTotalStock(client, branchId) {
  await client.query(
    `UPDATE products p
     SET stock = COALESCE(pb.total_stock, 0), "updatedAt" = NOW()
     FROM (
       SELECT "productId", SUM(stock) AS total_stock
       FROM product_branches
       GROUP BY "productId"
     ) pb
     WHERE p.id = pb."productId"
       AND EXISTS (
         SELECT 1 FROM product_branches pbf WHERE pbf."productId" = p.id AND pbf."branchId" = $1
       )`,
    [branchId],
  );
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const categoryByName = await ensureCategories(client);
    const branchId = await resolveBranchId(client);

    let created = 0;
    let updated = 0;
    for (const product of products) {
      const categoryId = categoryByName.get(product.categoryName);
      if (!categoryId) {
        throw new Error(`Missing categoryId for ${product.categoryName}`);
      }
      const action = await upsertProduct(client, product, categoryId, branchId);
      if (action === 'created') created += 1;
      if (action === 'updated') updated += 1;
    }

    await syncTotalStock(client, branchId);
    await client.query('COMMIT');

    console.log(`Done. Branch: ${branchId}, Created: ${created}, Updated: ${updated}, Total payload: ${products.length}`);
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
