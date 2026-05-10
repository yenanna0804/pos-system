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

describe('Branch access integration', () => {
  let app: INestApplication<App>;
  let adminUsername = 'it-admin-e2e';
  let managerUsername = 'it-br1-e2e';
  let ownBranchId = '';
  let otherBranchId = '';

  beforeAll(async () => {
    const dialect = process.env.DB_DIALECT ?? 'postgres';
    const passwordHash = await bcrypt.hash('123456', 10);
    if (dialect === 'sqlite') {
      const sqlitePath = process.env.SQLITE_PATH || 'local/dev.sqlite';
      const db = await open({ filename: sqlitePath, driver: sqlite3.Database });
      const existingBranches = await db.all<{ id: string }[]>('SELECT id FROM branches WHERE "isActive" = 1 ORDER BY name ASC LIMIT 2');
      if (existingBranches.length < 2) {
        await db.run('INSERT INTO branches (id, name, "isActive", "createdAt", "updatedAt") VALUES (?, ?, 1, datetime(\'now\'), datetime(\'now\'))', [randomUUID(), 'Chi nhanh A']);
        await db.run('INSERT INTO branches (id, name, "isActive", "createdAt", "updatedAt") VALUES (?, ?, 1, datetime(\'now\'), datetime(\'now\'))', [randomUUID(), 'Chi nhanh B']);
      }
      const branches = await db.all<{ id: string }[]>('SELECT id FROM branches WHERE "isActive" = 1 ORDER BY name ASC LIMIT 2');
      if (branches.length < 2) throw new Error('Need at least 2 active branches for integration tests');
      ownBranchId = branches[0].id;
      otherBranchId = branches[1].id;
      await db.run(
        `INSERT INTO users (id, username, password, "fullName", role, "branchId", "isActive", "createdAt", "updatedAt")
         VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
         ON CONFLICT(username) DO UPDATE SET password = excluded.password, role = excluded.role, "branchId" = excluded."branchId", "isActive" = 1, "updatedAt" = datetime('now')`,
        [randomUUID(), adminUsername, passwordHash, 'Integration Admin', 'ADMIN', ownBranchId],
      );
      await db.run(
        `INSERT INTO users (id, username, password, "fullName", role, "branchId", "isActive", "createdAt", "updatedAt")
         VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
         ON CONFLICT(username) DO UPDATE SET password = excluded.password, role = excluded.role, "branchId" = excluded."branchId", "isActive" = 1, "updatedAt" = datetime('now')`,
        [randomUUID(), managerUsername, passwordHash, 'Integration Branch Manager', 'MANAGER', ownBranchId],
      );
      await db.close();
    } else {
      const db = new Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      const branches = await db.query<{ id: string }>('SELECT id FROM branches WHERE "isActive" = true ORDER BY name ASC LIMIT 2');
      if (branches.rows.length < 2) throw new Error('Need at least 2 active branches for integration tests');
      ownBranchId = branches.rows[0].id;
      otherBranchId = branches.rows[1].id;
      await db.query(
        'INSERT INTO users (id, username, password, "fullName", role, "branchId", "isActive", "createdAt", "updatedAt") VALUES (gen_random_uuid()::text, $1, $2, $3, CAST($4 AS "UserRole"), $5, true, NOW(), NOW()) ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role, "branchId" = EXCLUDED."branchId", "isActive" = true, "updatedAt" = NOW()',
        [adminUsername, passwordHash, 'Integration Admin', 'ADMIN', ownBranchId],
      );
      await db.query(
        'INSERT INTO users (id, username, password, "fullName", role, "branchId", "isActive", "createdAt", "updatedAt") VALUES (gen_random_uuid()::text, $1, $2, $3, CAST($4 AS "UserRole"), $5, true, NOW(), NOW()) ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role, "branchId" = EXCLUDED."branchId", "isActive" = true, "updatedAt" = NOW()',
        [managerUsername, passwordHash, 'Integration Branch Manager', 'MANAGER', ownBranchId],
      );
      await db.end();
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('admin can access all branches data', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: adminUsername, password: '123456', branchId: '' })
      .expect(201);

    const token = loginRes.body?.token as string;
    expect(token).toBeTruthy();

    const res = await request(app.getHttpServer())
      .get('/areas')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('staff/manager can access own branch data', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: managerUsername, password: '123456', branchId: '' })
      .expect(201);

    const token = loginRes.body?.token as string;
    expect(token).toBeTruthy();
    expect(ownBranchId).toBeTruthy();

    const res = await request(app.getHttpServer())
      .get('/areas')
      .query({ branchId: ownBranchId })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('staff/manager spoofing another branch gets 403', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: managerUsername, password: '123456', branchId: '' })
      .expect(201);

    const token = loginRes.body?.token as string;
    expect(otherBranchId).toBeTruthy();

    await request(app.getHttpServer())
      .get('/areas')
      .query({ branchId: otherBranchId })
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });
});
