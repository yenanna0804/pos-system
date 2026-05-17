import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PgService } from '../../database/pg.service';
import { BranchPolicyService } from '../../common/branch-policy.service';
import type { CurrentUser } from '../../common/auth.types';

type AreaInput = { name: string; branchId?: string };
type RoomInput = { name: string; areaId: string; branchId?: string };
type DiningTableInput = {
  name: string;
  areaId: string;
  roomId?: string | null;
  branchId?: string;
  capacity?: number;
};

const NAME_REGEX = /^[\p{L}\p{N}\s&()./_-]{1,100}$/u;
import { VIETNAMESE_DIACRITICS_FROM, VIETNAMESE_DIACRITICS_TO } from '../../common/utils';

@Injectable()
export class TablesService {
  constructor(
    private db: PgService,
    private readonly branchPolicy: BranchPolicyService,
  ) {}

  private validateName(name: string, field = 'Tên') {
    const value = name?.trim() || '';
    if (!value) throw new BadRequestException(`${field} là bắt buộc`);
    if (!NAME_REGEX.test(value)) throw new BadRequestException(`${field} không đúng định dạng`);
    return value;
  }

  private async ensureAreaExists(areaId: string) {
    const rows = await this.db.query<{ id: string; "branchId": string | null }>(
      'SELECT id, "branchId" FROM areas WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
      [areaId],
    );
    if (!rows[0]) throw new NotFoundException('Khu vực không tồn tại');
    return rows[0];
  }

  private async ensureRoomExists(roomId: string) {
    const rows = await this.db.query<{ id: string; "areaId": string; "branchId": string | null }>(
      'SELECT id, "areaId", "branchId" FROM rooms WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
      [roomId],
    );
    if (!rows[0]) throw new NotFoundException('Phòng không tồn tại');
    return rows[0];
  }


  async listAreas(user: CurrentUser, branchId?: string) {
    const scopedBranchId = this.branchPolicy.resolveReadBranchId(user, branchId);
    const rows = await this.db.query(
      `SELECT a.id, a.name, a."branchId", a."createdAt", a."updatedAt",
              COALESCE(rc."roomCount", 0)::int AS "roomCount",
              COALESCE(tc."tableCount", 0)::int AS "tableCount"
       FROM areas a
       LEFT JOIN (SELECT "areaId", COUNT(*)::int AS "roomCount" FROM rooms WHERE "deletedAt" IS NULL GROUP BY "areaId") rc ON rc."areaId" = a.id
       LEFT JOIN (SELECT "areaId", COUNT(*)::int AS "tableCount" FROM tables WHERE "deletedAt" IS NULL GROUP BY "areaId") tc ON tc."areaId" = a.id
       WHERE a."deletedAt" IS NULL
         AND ($1::text IS NULL OR a."branchId" = $1)
       ORDER BY a."createdAt" DESC`,
       [scopedBranchId || null],
    );
    return rows;
  }

  async createArea(user: CurrentUser, input: AreaInput) {
    const name = this.validateName(input.name, 'Tên khu vực');
    const branchId = this.branchPolicy.resolveWriteBranchId(user, input.branchId);

    const id = randomUUID();
    await this.db.query(
      `INSERT INTO areas (id, name, "branchId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, name, branchId],
    );
    return { id, name, branchId };
  }

  async updateArea(user: CurrentUser, id: string, input: AreaInput) {
    const existed = await this.db.query<{ id: string; "branchId": string | null }>(
      'SELECT id, "branchId" FROM areas WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
      [id],
    );
    if (!existed[0]) throw new NotFoundException('Khu vực không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, existed[0].branchId);

    const name = this.validateName(input.name, 'Tên khu vực');
    const branchId = this.branchPolicy.resolveWriteBranchId(user, input.branchId ?? existed[0].branchId);

    await this.db.query('UPDATE areas SET name = $2, "branchId" = $3, "updatedAt" = NOW() WHERE id = $1', [id, name, branchId]);
    return { id, name, branchId };
  }

  async deleteArea(user: CurrentUser, id: string) {
    const existed = await this.db.query<{ id: string; "branchId": string | null }>(
      'SELECT id, "branchId" FROM areas WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
      [id],
    );
    if (!existed[0]) throw new NotFoundException('Khu vực không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, existed[0].branchId);
    await this.db.query(
      `UPDATE orders o
       SET "tableId" = NULL, "roomId" = NULL, "updatedAt" = NOW()
       WHERE o."roomId" IN (SELECT r.id FROM rooms r WHERE r."areaId" = $1 AND r."deletedAt" IS NULL)
          OR o."tableId" IN (SELECT t.id FROM tables t WHERE t."areaId" = $1 AND t."deletedAt" IS NULL)`,
      [id],
    );
    await this.db.query('DELETE FROM tables WHERE "areaId" = $1 AND "deletedAt" IS NULL', [id]);
    await this.db.query('DELETE FROM rooms WHERE "areaId" = $1 AND "deletedAt" IS NULL', [id]);
    await this.db.query('DELETE FROM areas WHERE id = $1', [id]);
    return { success: true };
  }

  async getAreaDeleteImpact(user: CurrentUser, id: string) {
    const existed = await this.db.query<{ id: string; name: string; "branchId": string | null }>(
      'SELECT id, name, "branchId" FROM areas WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
      [id],
    );
    if (!existed[0]) throw new NotFoundException('Khu vực không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, existed[0].branchId);

    const orderRefs = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM orders o
       WHERE o."orderState" <> $2
         AND (
           o."roomId" IN (SELECT r.id FROM rooms r WHERE r."areaId" = $1 AND r."deletedAt" IS NULL)
           OR o."tableId" IN (SELECT t.id FROM tables t WHERE t."areaId" = $1 AND t."deletedAt" IS NULL)
         )`,
      [id, 'DELETED'],
    );

    return {
      id,
      name: existed[0].name,
      activeOrderCount: Number(orderRefs[0]?.count || 0),
    };
  }

  async listRooms(user: CurrentUser, params: { areaId?: string; branchId?: string }) {
    const scopedBranchId = this.branchPolicy.resolveReadBranchId(user, params.branchId);
    const rows = await this.db.query(
      `SELECT r.id, r.name, r."areaId", r."branchId", r."createdAt", r."updatedAt",
              a.name AS "areaName",
              COALESCE(tc."tableCount", 0)::int AS "tableCount"
       FROM rooms r
       INNER JOIN areas a ON a.id = r."areaId" AND a."deletedAt" IS NULL
       LEFT JOIN (SELECT "roomId", COUNT(*)::int AS "tableCount" FROM tables WHERE "deletedAt" IS NULL GROUP BY "roomId") tc ON tc."roomId" = r.id
       WHERE r."deletedAt" IS NULL
         AND ($1::text IS NULL OR r."areaId" = $1)
         AND ($2::text IS NULL OR r."branchId" = $2)
       ORDER BY r."createdAt" DESC`,
      [params.areaId || null, scopedBranchId || null],
    );
    return rows;
  }

  async createRoom(user: CurrentUser, input: RoomInput) {
    const name = this.validateName(input.name, 'Tên phòng');
    const area = await this.ensureAreaExists(input.areaId);
    this.branchPolicy.assertResourceBranchAccess(user, area.branchId);
    const branchId = this.branchPolicy.resolveWriteBranchId(user, input.branchId ?? area.branchId);

    const id = randomUUID();
    await this.db.query(
      `INSERT INTO rooms (id, name, "areaId", "branchId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [id, name, input.areaId, branchId],
    );
    return { id, name, areaId: input.areaId, branchId };
  }

  async updateRoom(user: CurrentUser, id: string, input: RoomInput) {
    const existed = await this.db.query<{ id: string; "areaId": string; "branchId": string | null }>(
      'SELECT id, "areaId", "branchId" FROM rooms WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
      [id],
    );
    if (!existed[0]) throw new NotFoundException('Phòng không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, existed[0].branchId);

    const name = this.validateName(input.name, 'Tên phòng');
    const areaId = input.areaId || existed[0].areaId;
    const area = await this.ensureAreaExists(areaId);
    this.branchPolicy.assertResourceBranchAccess(user, area.branchId);
    const branchId = this.branchPolicy.resolveWriteBranchId(user, input.branchId ?? area.branchId ?? existed[0].branchId);

    await this.db.query(
      'UPDATE rooms SET name = $2, "areaId" = $3, "branchId" = $4, "updatedAt" = NOW() WHERE id = $1',
      [id, name, areaId, branchId],
    );
    await this.db.query('UPDATE tables SET "areaId" = $2, "updatedAt" = NOW() WHERE "roomId" = $1 AND "deletedAt" IS NULL', [id, areaId]);
    return { id, name, areaId, branchId };
  }

  async deleteRoom(user: CurrentUser, id: string) {
    const existed = await this.db.query<{ id: string; "branchId": string | null }>(
      'SELECT id, "branchId" FROM rooms WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
      [id],
    );
    if (!existed[0]) throw new NotFoundException('Phòng không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, existed[0].branchId);
    await this.db.query(
      `UPDATE orders o
       SET "tableId" = NULL, "roomId" = NULL, "updatedAt" = NOW()
       WHERE o."roomId" = $1
          OR o."tableId" IN (SELECT t.id FROM tables t WHERE t."roomId" = $1 AND t."deletedAt" IS NULL)`,
      [id],
    );
    await this.db.query('DELETE FROM tables WHERE "roomId" = $1 AND "deletedAt" IS NULL', [id]);
    await this.db.query('DELETE FROM rooms WHERE id = $1', [id]);
    return { success: true };
  }

  async getRoomDeleteImpact(user: CurrentUser, id: string) {
    const existed = await this.db.query<{ id: string; name: string; "branchId": string | null }>(
      'SELECT id, name, "branchId" FROM rooms WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
      [id],
    );
    if (!existed[0]) throw new NotFoundException('Phòng không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, existed[0].branchId);

    const orderRefs = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM orders o
       WHERE o."orderState" <> $2
         AND (
           o."roomId" = $1
           OR o."tableId" IN (SELECT t.id FROM tables t WHERE t."roomId" = $1 AND t."deletedAt" IS NULL)
         )`,
      [id, 'DELETED'],
    );

    return {
      id,
      name: existed[0].name,
      activeOrderCount: Number(orderRefs[0]?.count || 0),
    };
  }

  async listDiningTables(user: CurrentUser, params: {
    branchId?: string;
    areaId?: string;
    roomId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const scopedBranchId = this.branchPolicy.resolveReadBranchId(user, params.branchId);
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(7, Math.max(1, Number(params.pageSize) || 7));
    const offset = (page - 1) * pageSize;

    const whereParts: string[] = ['t."deletedAt" IS NULL'];
    const args: unknown[] = [];
    let idx = 1;

    if (scopedBranchId) {
      whereParts.push(`t."branchId" = $${idx++}`);
      args.push(scopedBranchId);
    }
    if (params.areaId) {
      whereParts.push(`t."areaId" = $${idx++}`);
      args.push(params.areaId);
    }
    if (params.roomId) {
      whereParts.push(`t."roomId" = $${idx++}`);
      args.push(params.roomId);
    }
    if (params.search?.trim()) {
      whereParts.push(
        `(translate(lower(t.name), '${VIETNAMESE_DIACRITICS_FROM}', '${VIETNAMESE_DIACRITICS_TO}') LIKE translate(lower($${idx}), '${VIETNAMESE_DIACRITICS_FROM}', '${VIETNAMESE_DIACRITICS_TO}')
          OR translate(lower(a.name), '${VIETNAMESE_DIACRITICS_FROM}', '${VIETNAMESE_DIACRITICS_TO}') LIKE translate(lower($${idx}), '${VIETNAMESE_DIACRITICS_FROM}', '${VIETNAMESE_DIACRITICS_TO}')
          OR translate(lower(COALESCE(r.name, '')), '${VIETNAMESE_DIACRITICS_FROM}', '${VIETNAMESE_DIACRITICS_TO}') LIKE translate(lower($${idx}), '${VIETNAMESE_DIACRITICS_FROM}', '${VIETNAMESE_DIACRITICS_TO}'))`,
      );
      args.push(`%${params.search.trim()}%`);
      idx += 1;
    }

    const whereSql = whereParts.join(' AND ');

    const countRows = await this.db.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM tables t
       INNER JOIN areas a ON a.id = t."areaId" AND a."deletedAt" IS NULL
       LEFT JOIN rooms r ON r.id = t."roomId" AND r."deletedAt" IS NULL
       WHERE ${whereSql}`,
      args,
    );
    const total = Number(countRows[0]?.total || 0);

    const rows = await this.db.query(
      `SELECT t.id, t.name, t.capacity, t.status, t."isActive", t."branchId", t."areaId", t."roomId", t."createdAt", t."updatedAt",
              a.name AS "areaName", r.name AS "roomName"
       FROM tables t
       INNER JOIN areas a ON a.id = t."areaId" AND a."deletedAt" IS NULL
       LEFT JOIN rooms r ON r.id = t."roomId" AND r."deletedAt" IS NULL
       WHERE ${whereSql}
       ORDER BY a.name ASC, r.name ASC NULLS FIRST, t.name ASC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...args, pageSize, offset],
    );

    return {
      items: rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async createDiningTable(user: CurrentUser, input: DiningTableInput) {
    const name = this.validateName(input.name, 'Tên bàn');
    if (!input.areaId) throw new BadRequestException('Khu vực là bắt buộc');
    const area = await this.ensureAreaExists(input.areaId);
    this.branchPolicy.assertResourceBranchAccess(user, area.branchId);
    const branchId = this.branchPolicy.resolveWriteBranchId(user, input.branchId ?? area.branchId);
    const roomId = input.roomId || null;

    if (roomId) {
      const room = await this.ensureRoomExists(roomId);
      if (room.areaId !== input.areaId) {
        throw new BadRequestException('Phòng phải thuộc khu vực đã chọn');
      }
    }


    const id = randomUUID();
    await this.db.query(
      `INSERT INTO tables (id, name, capacity, status, "isActive", "branchId", "areaId", "roomId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, CAST($4 AS "TableStatus"), $5, $6, $7, $8, NOW(), NOW())`,
      [id, name, Math.max(1, Number(input.capacity) || 4), 'AVAILABLE', true, branchId, input.areaId, roomId],
    );
    return { id, name, areaId: input.areaId, roomId, branchId };
  }

  async updateDiningTable(user: CurrentUser, id: string, input: DiningTableInput) {
    const existed = await this.db.query<{
      id: string;
      "branchId": string | null;
      "areaId": string | null;
      "roomId": string | null;
    }>('SELECT id, "branchId", "areaId", "roomId" FROM tables WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1', [id]);
    if (!existed[0]) throw new NotFoundException('Bàn không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, existed[0].branchId);

    const name = this.validateName(input.name, 'Tên bàn');
    const areaId = input.areaId || existed[0].areaId;
    if (!areaId) throw new BadRequestException('Khu vực là bắt buộc');
    const area = await this.ensureAreaExists(areaId);
    this.branchPolicy.assertResourceBranchAccess(user, area.branchId);
    const branchId = this.branchPolicy.resolveWriteBranchId(user, input.branchId ?? area.branchId ?? existed[0].branchId);
    const roomId = input.roomId === undefined ? existed[0].roomId : input.roomId || null;

    if (roomId) {
      const room = await this.ensureRoomExists(roomId);
      if (room.areaId !== areaId) {
        throw new BadRequestException('Phòng phải thuộc khu vực đã chọn');
      }
    }


    await this.db.query(
      `UPDATE tables
       SET name = $2, capacity = $3, "branchId" = $4, "areaId" = $5, "roomId" = $6, "updatedAt" = NOW()
       WHERE id = $1`,
      [id, name, Math.max(1, Number(input.capacity) || 4), branchId, areaId, roomId],
    );
    return { id, name, areaId, roomId, branchId };
  }

  async deleteDiningTable(user: CurrentUser, id: string) {
    const existed = await this.db.query<{ id: string; "branchId": string | null }>(
      'SELECT id, "branchId" FROM tables WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
      [id],
    );
    if (!existed[0]) throw new NotFoundException('Bàn không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, existed[0].branchId);

    await this.db.query(
      'UPDATE orders SET "tableId" = NULL, "roomId" = NULL, "updatedAt" = NOW() WHERE "tableId" = $1',
      [id],
    );

    await this.db.query('DELETE FROM tables WHERE id = $1', [id]);
    return { success: true };
  }

  async getDiningTableDeleteImpact(user: CurrentUser, id: string) {
    const existed = await this.db.query<{ id: string; name: string; "branchId": string | null }>(
      'SELECT id, name, "branchId" FROM tables WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
      [id],
    );
    if (!existed[0]) throw new NotFoundException('Bàn không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, existed[0].branchId);

    const orderRefs = await this.db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM orders WHERE "tableId" = $1 AND "orderState" <> $2',
      [id, 'DELETED'],
    );

    return {
      id,
      name: existed[0].name,
      activeOrderCount: Number(orderRefs[0]?.count || 0),
    };
  }

  async listDiningTableOptions(user: CurrentUser, params: { branchId?: string }) {
    const scopedBranchId = this.branchPolicy.resolveReadBranchId(user, params.branchId);
    const rows = await this.db.query(
      `SELECT t.id, t.name, t."areaId", t."roomId", a.name AS "areaName", r.name AS "roomName"
       FROM tables t
       INNER JOIN areas a ON a.id = t."areaId" AND a."deletedAt" IS NULL
       LEFT JOIN rooms r ON r.id = t."roomId" AND r."deletedAt" IS NULL
       WHERE t."deletedAt" IS NULL
         AND ($1::text IS NULL OR t."branchId" = $1)
       ORDER BY a.name ASC, r.name ASC NULLS FIRST, t.name ASC`,
       [scopedBranchId || null],
    );
    return rows;
  }
}
