import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Client } from 'pg';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';

describe('Order payment state integration', () => {
  let app: INestApplication<App>;
  let username = 'it-order-state-e2e';
  let branchId = '';
  let tableId = '';
  let productId = '';
  let productName = '';
  let productUnit = 'phan';
  let productPrice = 10000;

  beforeAll(async () => {
    const dialect = process.env.DB_DIALECT ?? 'postgres';
    const passwordHash = await bcrypt.hash('123456', 10);
    if (dialect === 'sqlite') {
      const sqlitePath = process.env.SQLITE_PATH || 'local/dev.sqlite';
      const db = await open({ filename: sqlitePath, driver: sqlite3.Database });
      const baseBranches = await db.all<{ id: string }[]>('SELECT id FROM branches WHERE "isActive" = 1 ORDER BY name ASC LIMIT 1');
      if (baseBranches.length === 0) {
        await db.run('INSERT INTO branches (id, name, "isActive", "createdAt", "updatedAt") VALUES (?, ?, 1, datetime(\'now\'), datetime(\'now\'))', [randomUUID(), 'Chi nhanh Test']);
      }
      const branchRows = await db.all<{ id: string }[]>('SELECT id FROM branches WHERE "isActive" = 1 ORDER BY name ASC LIMIT 1');
      if (branchRows.length === 0) throw new Error('No active branch found');
      branchId = branchRows[0].id;
      const areaId = randomUUID();
      await db.run('INSERT OR IGNORE INTO areas (id, name, "branchId", "createdAt", "updatedAt") VALUES (?, ?, ?, datetime(\'now\'), datetime(\'now\'))', [areaId, 'Khu A', branchId]);
      await db.run('INSERT OR IGNORE INTO tables (id, name, capacity, status, "isActive", "branchId", "areaId", "createdAt", "updatedAt") VALUES (?, ?, 4, ?, 1, ?, ?, datetime(\'now\'), datetime(\'now\'))', [randomUUID(), 'Ban A1', 'AVAILABLE', branchId, areaId]);
      await db.run('INSERT OR IGNORE INTO products (id, name, sku, "type", "autoPrice", price, stock, "isActive", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, 0, ?, 10, 1, datetime(\'now\'), datetime(\'now\'))', [randomUUID(), 'SP Test', `SKU-${Date.now()}`, 'SINGLE', 10000]);
      const tableRows = await db.all<{ id: string }[]>('SELECT id FROM tables WHERE "deletedAt" IS NULL AND "isActive" = 1 AND "branchId" = ? ORDER BY "createdAt" ASC LIMIT 1', [branchId]);
      if (tableRows.length === 0) throw new Error('No active table found');
      tableId = tableRows[0].id;
      const productRows = await db.all<{ id: string; name: string; unit: string | null; price: string }[]>('SELECT id, name, unit, CAST(price AS TEXT) AS price FROM products WHERE "deletedAt" IS NULL AND "isActive" = 1 ORDER BY "createdAt" ASC LIMIT 1');
      if (productRows.length === 0) throw new Error('No active product found');
      productId = productRows[0].id;
      productName = productRows[0].name;
      productUnit = productRows[0].unit || 'phan';
      productPrice = Number(productRows[0].price || 10000);
      await db.run(
        `INSERT INTO users (id, username, password, "fullName", role, "branchId", "isActive", "createdAt", "updatedAt")
         VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
         ON CONFLICT(username) DO UPDATE SET password = excluded.password, role = excluded.role, "branchId" = excluded."branchId", "isActive" = 1, "updatedAt" = datetime('now')`,
        [randomUUID(), username, passwordHash, 'Order State Tester', 'ADMIN', branchId],
      );
      await db.close();
    } else {
      const db = new Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      const branchRows = await db.query<{ id: string }>('SELECT id FROM branches WHERE "isActive" = true ORDER BY name ASC LIMIT 1');
      if (branchRows.rows.length === 0) throw new Error('No active branch found');
      branchId = branchRows.rows[0].id;
      const tableRows = await db.query<{ id: string }>('SELECT id FROM tables WHERE "deletedAt" IS NULL AND "isActive" = true AND "branchId" = $1 ORDER BY "createdAt" ASC LIMIT 1', [branchId]);
      if (tableRows.rows.length === 0) throw new Error('No active table found');
      tableId = tableRows.rows[0].id;
      const productRows = await db.query<{ id: string; name: string; unit: string | null; price: string }>('SELECT id, name, unit, price::text AS price FROM products WHERE "deletedAt" IS NULL AND "isActive" = true ORDER BY "createdAt" ASC LIMIT 1');
      if (productRows.rows.length === 0) throw new Error('No active product found');
      productId = productRows.rows[0].id;
      productName = productRows.rows[0].name;
      productUnit = productRows.rows[0].unit || 'phan';
      productPrice = Number(productRows.rows[0].price || 10000);
      await db.query('INSERT INTO users (id, username, password, "fullName", role, "branchId", "isActive", "createdAt", "updatedAt") VALUES (gen_random_uuid()::text, $1, $2, $3, CAST($4 AS "UserRole"), $5, true, NOW(), NOW()) ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role, "branchId" = EXCLUDED."branchId", "isActive" = true, "updatedAt" = NOW()', [username, passwordHash, 'Order State Tester', 'ADMIN', branchId]);
      await db.end();
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('creates order and keeps UNPAID when paidAmount is 0', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: '123456', branchId: '' })
      .expect(201);

    const token = loginRes.body?.token as string;
    expect(token).toBeTruthy();

    const createRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        entityType: 'TABLE',
        tableId,
        customerName: 'Khach test',
        totalAmount: productPrice,
        discountAmount: 0,
        surchargeAmount: 0,
        paidAmount: 0,
        paymentMethod: 'CASH',
        billItems: [
          {
            lineId: 'line-1',
            productId,
            productName,
            unit: productUnit,
            baseUnitPrice: productPrice,
            unitPrice: productPrice,
            quantity: 1,
            note: '',
          },
        ],
        branchId,
      })
      .expect(201);

    const orderId = createRes.body?.id as string;
    expect(orderId).toBeTruthy();

    const detailRes = await request(app.getHttpServer())
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(detailRes.body?.orderState).toBe('UNPAID');
    expect(Number(detailRes.body?.paidAmount || 0)).toBe(0);
    expect(detailRes.body?.paymentMethod).toBe('CASH');
  });

  it('creates order and sets PAID when paidAmount covers finalAmount', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: '123456', branchId: '' })
      .expect(201);

    const token = loginRes.body?.token as string;
    expect(token).toBeTruthy();

    const createRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        entityType: 'TABLE',
        tableId,
        customerName: 'Khach test paid',
        totalAmount: productPrice,
        discountAmount: 0,
        surchargeAmount: 0,
        paidAmount: productPrice,
        paymentMethod: 'BANKING',
        billItems: [
          {
            lineId: 'line-2',
            productId,
            productName,
            unit: productUnit,
            baseUnitPrice: productPrice,
            unitPrice: productPrice,
            quantity: 1,
            note: '',
          },
        ],
        branchId,
      })
      .expect(201);

    const orderId = createRes.body?.id as string;
    expect(orderId).toBeTruthy();

    const detailRes = await request(app.getHttpServer())
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(detailRes.body?.orderState).toBe('PAID');
    expect(Number(detailRes.body?.paidAmount || 0)).toBe(productPrice);
    expect(detailRes.body?.paymentMethod).toBe('BANKING');
  });

  it('creates order and forces PARTIAL when isDebtMarked is true', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: '123456', branchId: '' })
      .expect(201);

    const token = loginRes.body?.token as string;
    expect(token).toBeTruthy();

    const createRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        entityType: 'TABLE',
        tableId,
        customerName: 'Khach test debt',
        totalAmount: productPrice,
        discountAmount: 0,
        surchargeAmount: 0,
        paidAmount: productPrice,
        isDebtMarked: true,
        paymentMethod: 'CASH',
        billItems: [
          {
            lineId: 'line-debt-1',
            productId,
            productName,
            unit: productUnit,
            baseUnitPrice: productPrice,
            unitPrice: productPrice,
            quantity: 1,
            note: '',
          },
        ],
        branchId,
      })
      .expect(201);

    const orderId = createRes.body?.id as string;
    expect(orderId).toBeTruthy();

    const detailRes = await request(app.getHttpServer())
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(detailRes.body?.orderState).toBe('PARTIAL');
    expect(detailRes.body?.isDebtMarked).toBe(true);
  });

  it('persists discount/surcharge mode and raw values across create and update', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: '123456', branchId: '' })
      .expect(201);

    const token = loginRes.body?.token as string;
    expect(token).toBeTruthy();

    const createRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        entityType: 'TABLE',
        tableId,
        customerName: 'Khach test mode raw',
        totalAmount: productPrice * 2,
        discountMode: 'percent',
        discountValue: 10,
        surchargeMode: 'percent',
        surchargeValue: 5,
        paidAmount: 0,
        paymentMethod: 'CASH',
        billItems: [
          {
            lineId: 'line-3',
            productId,
            productName,
            unit: productUnit,
            baseUnitPrice: productPrice,
            unitPrice: productPrice,
            quantity: 2,
            note: '',
          },
        ],
        branchId,
      })
      .expect(201);

    const orderId = createRes.body?.id as string;
    expect(orderId).toBeTruthy();

    const detailAfterCreate = await request(app.getHttpServer())
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(detailAfterCreate.body?.discountMode).toBe('percent');
    expect(Number(detailAfterCreate.body?.discountValue)).toBe(10);
    expect(detailAfterCreate.body?.surchargeMode).toBe('percent');
    expect(Number(detailAfterCreate.body?.surchargeValue)).toBe(5);
    expect(detailAfterCreate.body?.paymentMethod).toBe('CASH');

    await request(app.getHttpServer())
      .patch(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        discountMode: 'amount',
        discountValue: 12000,
        surchargeMode: 'amount',
        surchargeValue: 6000,
        paymentMethod: 'BANKING',
      })
      .expect(200);

    const detailAfterUpdate = await request(app.getHttpServer())
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(detailAfterUpdate.body?.discountMode).toBe('amount');
    expect(Number(detailAfterUpdate.body?.discountValue)).toBe(12000);
    expect(detailAfterUpdate.body?.surchargeMode).toBe('amount');
    expect(Number(detailAfterUpdate.body?.surchargeValue)).toBe(6000);
    expect(detailAfterUpdate.body?.paymentMethod).toBe('BANKING');
  });

  it('marks order as DELETED when updated with empty bill items', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: '123456', branchId: '' })
      .expect(201);

    const token = loginRes.body?.token as string;
    expect(token).toBeTruthy();

    const createRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        entityType: 'TABLE',
        tableId,
        customerName: 'Khach update empty items',
        totalAmount: productPrice,
        discountAmount: 0,
        surchargeAmount: 0,
        paidAmount: 0,
        paymentMethod: 'CASH',
        billItems: [
          {
            lineId: 'line-empty-update-1',
            productId,
            productName,
            unit: productUnit,
            baseUnitPrice: productPrice,
            unitPrice: productPrice,
            quantity: 1,
            note: '',
          },
        ],
        branchId,
      })
      .expect(201);

    const orderId = createRes.body?.id as string;
    expect(orderId).toBeTruthy();

    await request(app.getHttpServer())
      .patch(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        billItems: [],
      })
      .expect(200);

    const detailRes = await request(app.getHttpServer())
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(detailRes.body?.orderState).toBe('DELETED');
    expect(Array.isArray(detailRes.body?.items)).toBe(true);
    expect(detailRes.body?.items?.length).toBe(0);
  });

  it('marks impacted order as DELETED when product deletion removes all items', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: '123456', branchId: '' })
      .expect(201);

    const token = loginRes.body?.token as string;
    expect(token).toBeTruthy();

    const productCreateRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'SINGLE',
        name: `E2E delete impact ${Date.now()}`,
        price: 15000,
        isActive: true,
        branchConfigs: [{ branchId, isActive: true, stock: 10 }],
      })
      .expect(201);

    const createdProductId = productCreateRes.body?.id as string;
    expect(createdProductId).toBeTruthy();

    const createdProductName = (productCreateRes.body?.name as string) || 'E2E item';
    const createdProductUnit = (productCreateRes.body?.unit as string) || 'phan';
    const createdProductPrice = Number(productCreateRes.body?.price || 15000);

    const orderCreateRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        entityType: 'TABLE',
        tableId,
        customerName: 'Khach delete product impact',
        totalAmount: createdProductPrice,
        discountAmount: 0,
        surchargeAmount: 0,
        paidAmount: 0,
        paymentMethod: 'CASH',
        billItems: [
          {
            lineId: 'line-delete-impact-1',
            productId: createdProductId,
            productName: createdProductName,
            unit: createdProductUnit,
            baseUnitPrice: createdProductPrice,
            unitPrice: createdProductPrice,
            quantity: 1,
            note: '',
          },
        ],
        branchId,
      })
      .expect(201);

    const orderId = orderCreateRes.body?.id as string;
    expect(orderId).toBeTruthy();

    await request(app.getHttpServer())
      .delete(`/products/${createdProductId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const detailRes = await request(app.getHttpServer())
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(detailRes.body?.orderState).toBe('DELETED');
    expect(Array.isArray(detailRes.body?.items)).toBe(true);
    expect(detailRes.body?.items?.length).toBe(0);
  });

  it('writes order history log when product deletion auto-updates order', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: '123456', branchId: '' })
      .expect(201);

    const token = loginRes.body?.token as string;
    expect(token).toBeTruthy();

    const productCreateRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'SINGLE',
        name: `E2E history impact ${Date.now()}`,
        price: 17000,
        isActive: true,
        branchConfigs: [{ branchId, isActive: true, stock: 10 }],
      })
      .expect(201);

    const createdProductId = productCreateRes.body?.id as string;
    expect(createdProductId).toBeTruthy();

    const createdProductName = (productCreateRes.body?.name as string) || 'E2E item';
    const createdProductUnit = (productCreateRes.body?.unit as string) || 'phan';
    const createdProductPrice = Number(productCreateRes.body?.price || 17000);

    const orderCreateRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        entityType: 'TABLE',
        tableId,
        customerName: 'Khach history product delete',
        totalAmount: createdProductPrice,
        discountAmount: 0,
        surchargeAmount: 0,
        paidAmount: 0,
        paymentMethod: 'CASH',
        billItems: [
          {
            lineId: 'line-history-impact-1',
            productId: createdProductId,
            productName: createdProductName,
            unit: createdProductUnit,
            baseUnitPrice: createdProductPrice,
            unitPrice: createdProductPrice,
            quantity: 1,
            note: '',
          },
        ],
        branchId,
      })
      .expect(201);

    const orderId = orderCreateRes.body?.id as string;
    expect(orderId).toBeTruthy();

    await request(app.getHttpServer())
      .delete(`/products/${createdProductId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const logsRes = await request(app.getHttpServer())
      .get(`/orders/${orderId}/logs`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const logs = Array.isArray(logsRes.body) ? logsRes.body : [];
    const autoLog = logs.find((log: { action?: string; detail?: string }) =>
      (log.action === 'DELETE_ORDER' || log.action === 'UPDATE_ORDER')
      && (log.detail || '').includes('xóa hàng hóa'),
    );

    expect(autoLog).toBeTruthy();
  });

  it('supports independent timer sessions for multiple TIME lines of same service', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: '123456', branchId: '' })
      .expect(201);

    const token = loginRes.body?.token as string;
    expect(token).toBeTruthy();

    const timeProductRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'TIME',
        name: `E2E TIME ${Date.now()}`,
        isActive: true,
        timeRateAmount: 30000,
        timeRateMinutes: 60,
        branchConfigs: [{ branchId, isActive: true }],
      })
      .expect(201);

    const timeProductId = timeProductRes.body?.id as string;
    const timeProductName = (timeProductRes.body?.name as string) || 'TIME E2E';
    expect(timeProductId).toBeTruthy();

    const lineId1 = randomUUID();
    const lineId2 = randomUUID();

    const createRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        entityType: 'TABLE',
        tableId,
        customerName: 'Khach TIME sessions',
        paidAmount: 0,
        paymentMethod: 'CASH',
        billItems: [
          {
            lineId: lineId1,
            productId: timeProductId,
            productName: timeProductName,
            unitPrice: 30000,
            quantity: 1,
            pricingTypeSnapshot: 'TIME',
            timeRateAmountSnapshot: 30000,
            timeRateMinutesSnapshot: 60,
            usedMinutes: 0,
            note: '',
          },
          {
            lineId: lineId2,
            productId: timeProductId,
            productName: timeProductName,
            unitPrice: 30000,
            quantity: 1,
            pricingTypeSnapshot: 'TIME',
            timeRateAmountSnapshot: 30000,
            timeRateMinutesSnapshot: 60,
            usedMinutes: 0,
            note: '',
          },
        ],
        branchId,
      })
      .expect(201);

    const orderId = createRes.body?.id as string;
    expect(orderId).toBeTruthy();

    await request(app.getHttpServer())
      .post(`/orders/${orderId}/items/${lineId2}/timer/start`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/orders/${orderId}/items/${lineId2}/timer/stop`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/orders/${orderId}/items/${lineId1}/timer/start`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/orders/${orderId}/items/${lineId1}/timer/stop`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const detailRes = await request(app.getHttpServer())
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const items = Array.isArray(detailRes.body?.items) ? detailRes.body.items : [];
    const line1 = items.find((item: { lineId: string }) => item.lineId === lineId1);
    const line2 = items.find((item: { lineId: string }) => item.lineId === lineId2);

    expect(line1).toBeTruthy();
    expect(line2).toBeTruthy();
    expect(line1?.pricingTypeSnapshot).toBe('TIME');
    expect(line2?.pricingTypeSnapshot).toBe('TIME');
    expect(Number(line1?.usedMinutes || 0)).toBeGreaterThan(0);
    expect(Number(line2?.usedMinutes || 0)).toBeGreaterThan(0);
    expect(line1?.timerStatus).toBe('STOPPED');
    expect(line2?.timerStatus).toBe('STOPPED');
  });

  it('starts timer by clientLineId for existing TIME line', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: '123456', branchId: '' })
      .expect(201);

    const token = loginRes.body?.token as string;
    expect(token).toBeTruthy();

    const timeProductRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'TIME',
        name: `E2E TIME START BY CLIENT ${Date.now()}`,
        isActive: true,
        timeRateAmount: 45000,
        timeRateMinutes: 60,
        branchConfigs: [{ branchId, isActive: true }],
      })
      .expect(201);

    const timeProductId = timeProductRes.body?.id as string;
    const timeProductName = (timeProductRes.body?.name as string) || 'TIME E2E';
    const clientLineId = randomUUID();

    const createRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        entityType: 'TABLE',
        tableId,
        customerName: 'Khach start by clientLine existing',
        paidAmount: 0,
        paymentMethod: 'CASH',
        billItems: [
          {
            lineId: clientLineId,
            productId: timeProductId,
            productName: timeProductName,
            unitPrice: 45000,
            quantity: 1,
            pricingTypeSnapshot: 'TIME',
            timeRateAmountSnapshot: 45000,
            timeRateMinutesSnapshot: 60,
            usedMinutes: 0,
            note: '',
          },
        ],
        branchId,
      })
      .expect(201);

    const orderId = createRes.body?.id as string;
    expect(orderId).toBeTruthy();

    const startRes = await request(app.getHttpServer())
      .post(`/orders/${orderId}/commands/start-time-line`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        clientLineId,
        lineSnapshot: {
          productId: timeProductId,
          productName: timeProductName,
          pricingTypeSnapshot: 'TIME',
          unitPrice: 45000,
          timeRateAmountSnapshot: 45000,
          timeRateMinutesSnapshot: 60,
          note: '',
        },
      })
      .expect(201);

    expect(startRes.body?.clientLineId).toBe(clientLineId);
    expect(startRes.body?.orderItemId).toBe(clientLineId);
    expect(startRes.body?.timerStatus).toBe('RUNNING');
    expect(Number(startRes.body?.lineTotal || 0)).toBeGreaterThan(0);
  });

  it('persists new TIME line and starts timer by clientLineId for unsaved line', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: '123456', branchId: '' })
      .expect(201);

    const token = loginRes.body?.token as string;
    expect(token).toBeTruthy();

    const timeProductRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'TIME',
        name: `E2E TIME UNSAVED ${Date.now()}`,
        isActive: true,
        timeRateAmount: 30000,
        timeRateMinutes: 30,
        branchConfigs: [{ branchId, isActive: true }],
      })
      .expect(201);

    const timeProductId = timeProductRes.body?.id as string;
    const timeProductName = (timeProductRes.body?.name as string) || 'TIME E2E';

    const createRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        entityType: 'TABLE',
        tableId,
        customerName: 'Khach start by clientLine unsaved',
        paidAmount: 0,
        paymentMethod: 'CASH',
        billItems: [],
        branchId,
      })
      .expect(400);

    expect(createRes.body?.message).toContain('ít nhất một món');

    const seedOrderRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        entityType: 'TABLE',
        tableId,
        customerName: 'Khach seed order for unsaved line',
        paidAmount: 0,
        paymentMethod: 'CASH',
        billItems: [
          {
            lineId: randomUUID(),
            productId,
            productName,
            unit: productUnit,
            baseUnitPrice: productPrice,
            unitPrice: productPrice,
            quantity: 1,
            note: '',
          },
        ],
        branchId,
      })
      .expect(201);

    const orderId = seedOrderRes.body?.id as string;
    expect(orderId).toBeTruthy();

    const clientLineId = `draft-${Date.now()}`;
    const startRes = await request(app.getHttpServer())
      .post(`/orders/${orderId}/commands/start-time-line`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        clientLineId,
        lineSnapshot: {
          productId: timeProductId,
          productName: timeProductName,
          pricingTypeSnapshot: 'TIME',
          unitPrice: 30000,
          timeRateAmountSnapshot: 30000,
          timeRateMinutesSnapshot: 30,
          note: 'line unsaved',
        },
      })
      .expect(201);

    expect(startRes.body?.clientLineId).toBe(clientLineId);
    expect(startRes.body?.orderItemId).toBeTruthy();
    expect(startRes.body?.orderItemId).not.toBe(clientLineId);
    expect(startRes.body?.timerStatus).toBe('RUNNING');
    expect(Number(startRes.body?.lineTotal || 0)).toBe(30000);

    await request(app.getHttpServer())
      .post(`/orders/${orderId}/items/${startRes.body?.orderItemId}/timer/stop`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
  });
});
