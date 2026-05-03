const API_BASE = process.env.API_BASE || 'http://localhost:3000/api';
const USER_ID = process.env.USER_ID || 'admin-user-default';
const BRANCH_ID = process.env.BRANCH_ID || 'default-branch-1';

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
  { sku: 'WINE015', name: 'Jacob Spakling', price: null, unit: 'Chai', categoryName: 'Western Wine' },
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
  { sku: 'SRV006', name: 'Snack', price: 129000, unit: 'Phan', categoryName: 'Service' },
  { sku: 'SRV007', name: 'Thuốc lá Thăng Long', price: 39000, unit: 'Bao', categoryName: 'Service' },
  { sku: 'SRV008', name: 'Thuốc lá Ken, 555, Camel', price: 89000, unit: 'Bao', categoryName: 'Service' },
  { sku: 'SRV009', name: 'Thuốc lá Man, Vina, Ngựa', price: 79000, unit: 'Bao', categoryName: 'Service' },
  { sku: 'SRV010', name: 'Khăn lạnh', price: 8000, unit: 'Cai', categoryName: 'Service' },
];

function createToken(userId) {
  return Buffer.from(`${userId}:${Date.now()}`).toString('base64');
}

async function request(path, method = 'GET', body, token) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const msg = data?.message || `${response.status} ${response.statusText}`;
    throw new Error(`${method} ${path} failed: ${msg}`);
  }
  return data;
}

async function run() {
  const token = createToken(USER_ID);

  const categories = await request('/categories', 'GET', undefined, token);
  const categoryByName = new Map(categories.map((c) => [String(c.name).toLowerCase(), c]));

  for (const categoryName of categoryNames) {
    if (!categoryByName.has(categoryName.toLowerCase())) {
      const created = await request('/categories', 'POST', { name: categoryName }, token);
      categoryByName.set(categoryName.toLowerCase(), created);
      console.log(`Created category: ${created.name}`);
    }
  }

  const firstPage = await request('/products?page=1&pageSize=1000', 'GET', undefined, token);
  const existingBySku = new Map((firstPage.items || []).filter((p) => p.sku).map((p) => [p.sku, p]));

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let skippedNoPrice = 0;
  for (const product of products) {
    if (!Number.isFinite(product.price) || product.price <= 0) {
      skippedNoPrice += 1;
      console.log(`Skipped missing/invalid price: ${product.sku} - ${product.name}`);
      continue;
    }

    const category = categoryByName.get(product.categoryName.toLowerCase());
    const payload = {
      type: 'SINGLE',
      autoPrice: false,
      sku: product.sku,
      name: product.name,
      categoryId: category?.id || null,
      unit: product.unit,
      weight: 0,
      costPrice: 0,
      price: product.price,
      isActive: true,
      branchConfigs: [{ branchId: BRANCH_ID, isActive: true, stock: 0 }],
    };

    const existed = existingBySku.get(product.sku);
    if (existed?.id) {
      await request(`/products/${existed.id}`, 'PATCH', payload, token);
      updatedCount += 1;
      console.log(`Updated product: ${product.sku} - ${product.name}`);
      continue;
    }

    await request('/products', 'POST', payload, token);
    createdCount += 1;
    console.log(`Created product: ${product.sku} - ${product.name}`);
  }

  console.log(`Done. Created: ${createdCount}, Updated: ${updatedCount}, Skipped existing: ${skippedCount}, Skipped no-price: ${skippedNoPrice}`);
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
