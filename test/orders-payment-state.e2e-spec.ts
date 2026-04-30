import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
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
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    const branchRows = await db.query<{ id: string }>('SELECT id FROM branches WHERE "isActive" = true ORDER BY name ASC LIMIT 1');
    if (branchRows.rows.length === 0) throw new Error('No active branch found');
    branchId = branchRows.rows[0].id;

    const tableRows = await db.query<{ id: string }>(
      'SELECT id FROM tables WHERE "deletedAt" IS NULL AND "isActive" = true AND "branchId" = $1 ORDER BY "createdAt" ASC LIMIT 1',
      [branchId],
    );
    if (tableRows.rows.length === 0) throw new Error('No active table found');
    tableId = tableRows.rows[0].id;

    const productRows = await db.query<{ id: string; name: string; unit: string | null; price: string }>(
      'SELECT id, name, unit, price::text AS price FROM products WHERE "deletedAt" IS NULL AND "isActive" = true ORDER BY "createdAt" ASC LIMIT 1',
    );
    if (productRows.rows.length === 0) throw new Error('No active product found');
    productId = productRows.rows[0].id;
    productName = productRows.rows[0].name;
    productUnit = productRows.rows[0].unit || 'phan';
    productPrice = Number(productRows.rows[0].price || 10000);

    const passwordHash = await bcrypt.hash('123456', 10);
    await db.query(
      'INSERT INTO users (id, username, password, "fullName", role, "branchId", "isActive", "createdAt", "updatedAt") VALUES (gen_random_uuid()::text, $1, $2, $3, CAST($4 AS "UserRole"), $5, true, NOW(), NOW()) ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role, "branchId" = EXCLUDED."branchId", "isActive" = true, "updatedAt" = NOW()',
      [username, passwordHash, 'Order State Tester', 'ADMIN', branchId],
    );

    await db.end();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('creates order and keeps PARTIAL when paidAmount is 0', async () => {
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

    expect(detailRes.body?.orderState).toBe('PARTIAL');
    expect(Number(detailRes.body?.paidAmount || 0)).toBe(0);
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

    await request(app.getHttpServer())
      .patch(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        discountMode: 'amount',
        discountValue: 12000,
        surchargeMode: 'amount',
        surchargeValue: 6000,
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
  });
});
