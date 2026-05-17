PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  email TEXT UNIQUE,
  fullName TEXT,
  role TEXT NOT NULL DEFAULT 'STAFF' CHECK(role IN ('ADMIN','MANAGER','STAFF')),
  branchId TEXT,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (branchId) REFERENCES branches(id)
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parentId TEXT,
  sortOrder INTEGER NOT NULL DEFAULT 0,
  isActive INTEGER NOT NULL DEFAULT 1,
  deletedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (parentId) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  branchId TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  deletedAt TEXT,
  FOREIGN KEY (branchId) REFERENCES branches(id)
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  areaId TEXT NOT NULL,
  branchId TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  deletedAt TEXT,
  FOREIGN KEY (areaId) REFERENCES areas(id),
  FOREIGN KEY (branchId) REFERENCES branches(id)
);

CREATE TABLE IF NOT EXISTS tables (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE','OCCUPIED','RESERVED')),
  branchId TEXT,
  areaId TEXT,
  roomId TEXT,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  deletedAt TEXT,
  FOREIGN KEY (branchId) REFERENCES branches(id),
  FOREIGN KEY (areaId) REFERENCES areas(id),
  FOREIGN KEY (roomId) REFERENCES rooms(id)
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT UNIQUE,
  barcode TEXT,
  type TEXT NOT NULL DEFAULT 'SINGLE' CHECK(type IN ('SINGLE','COMBO','TIME')),
  autoPrice INTEGER NOT NULL DEFAULT 0,
  price NUMERIC NOT NULL,
  costPrice NUMERIC,
  unit TEXT,
  weight NUMERIC,
  stock NUMERIC NOT NULL DEFAULT 0,
  imageUrl TEXT,
  imageThumb TEXT,
  timeRateAmount NUMERIC,
  timeRateMinutes INTEGER,
  description TEXT,
  isActive INTEGER NOT NULL DEFAULT 1,
  deletedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  categoryId TEXT,
  FOREIGN KEY (categoryId) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS product_branches (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL,
  branchId TEXT NOT NULL,
  isActive INTEGER NOT NULL DEFAULT 1,
  stock NUMERIC NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(productId, branchId),
  FOREIGN KEY (productId) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_combo_items (
  id TEXT PRIMARY KEY,
  comboProductId TEXT NOT NULL,
  itemProductId TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(comboProductId, itemProductId),
  FOREIGN KEY (comboProductId) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (itemProductId) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  orderCode TEXT NOT NULL UNIQUE,
  tableId TEXT,
  roomId TEXT,
  branchId TEXT,
  userId TEXT NOT NULL,
  totalAmount NUMERIC NOT NULL,
  discountAmount NUMERIC NOT NULL DEFAULT 0,
  discountMode TEXT NOT NULL DEFAULT 'amount' CHECK(discountMode IN ('amount','percent')),
  discountValue NUMERIC NOT NULL DEFAULT 0,
  surchargeAmount NUMERIC NOT NULL DEFAULT 0,
  surchargeMode TEXT NOT NULL DEFAULT 'amount' CHECK(surchargeMode IN ('amount','percent')),
  surchargeValue NUMERIC NOT NULL DEFAULT 0,
  finalAmount NUMERIC NOT NULL,
  paidAmount NUMERIC NOT NULL DEFAULT 0,
  customerName TEXT,
  orderState TEXT NOT NULL DEFAULT 'PARTIAL' CHECK(orderState IN ('DRAFT','PARTIAL','UNPAID','PAID','DELETED')),
  paymentMethod TEXT CHECK(paymentMethod IN ('CASH','CARD','QR_CODE','BANKING')),
  note TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tableId) REFERENCES tables(id),
  FOREIGN KEY (roomId) REFERENCES rooms(id),
  FOREIGN KEY (branchId) REFERENCES branches(id),
  FOREIGN KEY (userId) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS order_logs (
  id TEXT PRIMARY KEY,
  orderId TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('CREATE_ORDER','UPDATE_ORDER','PRINT_ORDER','DELETE_ORDER','PAY_PARTIAL','PAY_FULL')),
  detail TEXT,
  snapshot TEXT,
  createdBy TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  orderId TEXT NOT NULL,
  productId TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  pricingTypeSnapshot TEXT NOT NULL DEFAULT 'FIXED' CHECK(pricingTypeSnapshot IN ('FIXED','TIME')),
  baseUnitPrice NUMERIC,
  unitPrice NUMERIC NOT NULL,
  lineDiscountAmount NUMERIC NOT NULL DEFAULT 0,
  lineSurchargeAmount NUMERIC NOT NULL DEFAULT 0,
  totalPrice NUMERIC NOT NULL,
  timeRateAmountSnapshot NUMERIC,
  timeRateMinutesSnapshot INTEGER,
  usedMinutes INTEGER NOT NULL DEFAULT 0,
  startAt TEXT,
  stopAt TEXT,
  displayOrder INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (productId) REFERENCES products(id)
);
