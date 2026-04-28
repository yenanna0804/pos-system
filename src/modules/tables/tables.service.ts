import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PgService } from '../../database/pg.service';

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
const VIETNAMESE_DIACRITICS_FROM =
  'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';
const VIETNAMESE_DIACRITICS_TO =
  'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiioooooooooooooooooouuuuuuuuuuuyyyyyd';

@Injectable()
export class TablesService {
  constructor(private db: PgService) {}

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


  async listAreas(branchId?: string) {
    const rows = await this.db.query(
      `SELECT a.id, a.name, a."branchId", a."createdAt", a."updatedAt",
              COALESCE((SELECT COUNT(*)::int FROM rooms r WHERE r."areaId" = a.id AND r."deletedAt" IS NULL), 0) AS "roomCount",
              COALESCE((SELECT COUNT(*)::int FROM tables t WHERE t."areaId" = a.id AND t."deletedAt" IS NULL), 0) AS "tableCount"
       FROM areas a
       WHERE a."deletedAt" IS NULL
         AND ($1::text IS NULL OR a."branchId" = $1)
       ORDER BY a."createdAt" DESC`,
      [branchId || null],
    );
    return rows;
  }

  async createArea(input: AreaInput) {
    const name = this.validateName(input.name, 'Tên khu vực');
    const branchId = input.branchId || null;

    const id = randomUUID();
    await this.db.query(
      `INSERT INTO areas (id, name, "branchId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, name, branchId],
    );
    return { id, name, branchId };
  }

  async updateArea(id: string, input: AreaInput) {
    const existed = await this.db.query<{ id: string; "branchId": string | null }>(
      'SELECT id, "branchId" FROM areas WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
      [id],
    );
    if (!existed[0]) throw new NotFoundException('Khu vực không tồn tại');

    const name = this.validateName(input.name, 'Tên khu vực');
    const branchId = input.branchId ?? existed[0].branchId;

    await this.db.query('UPDATE areas SET name = $2, "branchId" = $3, "updatedAt" = NOW() WHERE id = $1', [id, name, branchId]);
    return { id, name, branchId };
  }

  async deleteArea(id: string) {
    const existed = await this.db.query<{ id: string }>('SELECT id FROM areas WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1', [id]);
    if (!existed[0]) throw new NotFoundException('Khu vực không tồn tại');
    await this.db.query('UPDATE rooms SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE "areaId" = $1 AND "deletedAt" IS NULL', [id]);
    await this.db.query('UPDATE tables SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE "areaId" = $1 AND "deletedAt" IS NULL', [id]);
    await this.db.query('UPDATE areas SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1', [id]);
    return { success: true };
  }

  async listRooms(params: { areaId?: string; branchId?: string }) {
    const rows = await this.db.query(
      `SELECT r.id, r.name, r."areaId", r."branchId", r."createdAt", r."updatedAt",
              a.name AS "areaName",
              COALESCE((SELECT COUNT(*)::int FROM tables t WHERE t."roomId" = r.id AND t."deletedAt" IS NULL), 0) AS "tableCount"
       FROM rooms r
       INNER JOIN areas a ON a.id = r."areaId" AND a."deletedAt" IS NULL
       WHERE r."deletedAt" IS NULL
         AND ($1::text IS NULL OR r."areaId" = $1)
         AND ($2::text IS NULL OR r."branchId" = $2)
       ORDER BY r."createdAt" DESC`,
      [params.areaId || null, params.branchId || null],
    );
    return rows;
  }

  async createRoom(input: RoomInput) {
    const name = this.validateName(input.name, 'Tên phòng');
    const area = await this.ensureAreaExists(input.areaId);
    const branchId = input.branchId ?? area.branchId ?? null;

    const id = randomUUID();
    await this.db.query(
      `INSERT INTO rooms (id, name, "areaId", "branchId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [id, name, input.areaId, branchId],
    );
    return { id, name, areaId: input.areaId, branchId };
  }

  async updateRoom(id: string, input: RoomInput) {
    const existed = await this.db.query<{ id: string; "areaId": string; "branchId": string | null }>(
      'SELECT id, "areaId", "branchId" FROM rooms WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
      [id],
    );
    if (!existed[0]) throw new NotFoundException('Phòng không tồn tại');

    const name = this.validateName(input.name, 'Tên phòng');
    const areaId = input.areaId || existed[0].areaId;
    const area = await this.ensureAreaExists(areaId);
    const branchId = input.branchId ?? area.branchId ?? existed[0].branchId ?? null;

    await this.db.query(
      'UPDATE rooms SET name = $2, "areaId" = $3, "branchId" = $4, "updatedAt" = NOW() WHERE id = $1',
      [id, name, areaId, branchId],
    );
    await this.db.query('UPDATE tables SET "areaId" = $2, "updatedAt" = NOW() WHERE "roomId" = $1 AND "deletedAt" IS NULL', [id, areaId]);
    return { id, name, areaId, branchId };
  }

  async deleteRoom(id: string) {
    const existed = await this.db.query<{ id: string }>('SELECT id FROM rooms WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1', [id]);
    if (!existed[0]) throw new NotFoundException('Phòng không tồn tại');
    await this.db.query('UPDATE tables SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE "roomId" = $1 AND "deletedAt" IS NULL', [id]);
    await this.db.query('UPDATE rooms SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1', [id]);
    return { success: true };
  }

  async listDiningTables(params: {
    branchId?: string;
    areaId?: string;
    roomId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(7, Math.max(1, Number(params.pageSize) || 7));
    const offset = (page - 1) * pageSize;

    const whereParts: string[] = ['t."deletedAt" IS NULL'];
    const args: unknown[] = [];
    let idx = 1;

    if (params.branchId) {
      whereParts.push(`t."branchId" = $${idx++}`);
      args.push(params.branchId);
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

  async createDiningTable(input: DiningTableInput) {
    const name = this.validateName(input.name, 'Tên bàn');
    if (!input.areaId) throw new BadRequestException('Khu vực là bắt buộc');
    const area = await this.ensureAreaExists(input.areaId);
    const branchId = input.branchId ?? area.branchId ?? null;
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

  async updateDiningTable(id: string, input: DiningTableInput) {
    const existed = await this.db.query<{
      id: string;
      "branchId": string | null;
      "areaId": string | null;
      "roomId": string | null;
    }>('SELECT id, "branchId", "areaId", "roomId" FROM tables WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1', [id]);
    if (!existed[0]) throw new NotFoundException('Bàn không tồn tại');

    const name = this.validateName(input.name, 'Tên bàn');
    const areaId = input.areaId || existed[0].areaId;
    if (!areaId) throw new BadRequestException('Khu vực là bắt buộc');
    const area = await this.ensureAreaExists(areaId);
    const branchId = input.branchId ?? area.branchId ?? existed[0].branchId ?? null;
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

  async deleteDiningTable(id: string) {
    const existed = await this.db.query<{ id: string }>('SELECT id FROM tables WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1', [id]);
    if (!existed[0]) throw new NotFoundException('Bàn không tồn tại');

    const orderRefs = await this.db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM orders WHERE "tableId" = $1 AND status <> CAST($2 AS "OrderStatus")',
      [id, 'CANCELLED'],
    );
    if (Number(orderRefs[0]?.count || 0) > 0) {
      throw new BadRequestException('Không thể xóa bàn đã phát sinh hóa đơn');
    }

    await this.db.query('UPDATE tables SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1', [id]);
    return { success: true };
  }

  async listDiningTableOptions(params: { branchId?: string }) {
    const rows = await this.db.query(
      `SELECT t.id, t.name, t."areaId", t."roomId", a.name AS "areaName", r.name AS "roomName"
       FROM tables t
       INNER JOIN areas a ON a.id = t."areaId" AND a."deletedAt" IS NULL
       LEFT JOIN rooms r ON r.id = t."roomId" AND r."deletedAt" IS NULL
       WHERE t."deletedAt" IS NULL
         AND ($1::text IS NULL OR t."branchId" = $1)
       ORDER BY a.name ASC, r.name ASC NULLS FIRST, t.name ASC`,
      [params.branchId || null],
    );
    return rows;
  }
}
