import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PgService } from '../../database/pg.service';
import { BranchPolicyService } from '../../common/branch-policy.service';
import type { CurrentUser } from '../../common/auth.types';
import type { QueryResultRow } from 'pg';

type CreateOrderInput = {
  entityType: 'TABLE' | 'ROOM';
  tableId?: string;
  roomId?: string;
  customerName?: string;
  totalAmount: number;
  discountAmount?: number;
  surchargeAmount?: number;
  billItems: {
    lineId: string;
    productId: string;
    productName: string;
    unit?: string;
    baseUnitPrice?: number;
    unitPrice: number;
    quantity: number;
    note: string;
  }[];
  branchId?: string;
};

type UpdateOrderInput = {
  entityType?: 'TABLE' | 'ROOM';
  tableId?: string;
  roomId?: string;
  customerName?: string;
  totalAmount?: number;
  discountAmount?: number;
  surchargeAmount?: number;
  billItems?: {
    lineId: string;
    productId: string;
    productName: string;
    unit?: string;
    baseUnitPrice?: number;
    unitPrice: number;
    quantity: number;
    note: string;
  }[];
};

type NormalizedOrderItem = {
  lineId: string;
  productId: string;
  productName: string;
  unit?: string;
  baseUnitPrice: number;
  unitPrice: number;
  quantity: number;
  note: string;
  lineTotal: number;
};

type OrdersExecutor = {
  query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
};

@Injectable()
export class OrdersService {
  private schemaReady = false;

  constructor(
    private readonly db: PgService,
    private readonly branchPolicy: BranchPolicyService,
  ) {}

  private buildOrderCodePrefix(date: Date) {
    const yy = String(date.getFullYear()).slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `HD${yy}${mm}${dd}`;
  }

  private async generateNextOrderCode(executor: OrdersExecutor, date: Date) {
    const prefix = this.buildOrderCodePrefix(date);
    const startIndex = prefix.length + 1;
    const rows = await executor.query<{ nextSeq: string }>(
      `SELECT COALESCE(MAX(CAST(SUBSTRING("orderCode" FROM $2) AS integer)), 0) + 1 AS "nextSeq"
       FROM orders
       WHERE "orderCode" LIKE $1
         AND "orderCode" ~ $3`,
      [`${prefix}%`, startIndex, `^${prefix}[0-9]+$`],
    );
    const nextSeq = Number(rows[0]?.nextSeq || 1);
    return `${prefix}${nextSeq}`;
  }

  private async ensureSchema() {
    if (this.schemaReady) return;

    await this.db.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS "customerName" text;
    `);
    await this.db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS "orderCode" text');
    await this.db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS "roomId" text');

    await this.db.query('ALTER TABLE orders DROP COLUMN IF EXISTS "billItems"');
    await this.db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS "paidAmount" numeric(14,2) NOT NULL DEFAULT 0');
    await this.db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS "orderState" text');
    await this.db.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'orders' AND column_name = 'taxAmount'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'orders' AND column_name = 'surchargeAmount'
        ) THEN
          EXECUTE 'ALTER TABLE orders RENAME COLUMN "taxAmount" TO "surchargeAmount"';
        END IF;
      END $$;
    `);
    await this.db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS "surchargeAmount" numeric(14,2) NOT NULL DEFAULT 0');
    await this.db.query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS "baseUnitPrice" numeric(14,2)');
    await this.db.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_code_unique ON orders("orderCode")');
    await this.db.query(`UPDATE orders SET "orderCode" = CONCAT('HDN-', UPPER(RIGHT(id, 8))) WHERE "orderCode" IS NULL OR "orderCode" = ''`);
    await this.db.query(
      `UPDATE orders
       SET "orderState" = CASE
         WHEN COALESCE("paidAmount", 0) <= 0 THEN 'DRAFT'
         WHEN COALESCE("paidAmount", 0) >= COALESCE("finalAmount", 0) THEN 'PAID'
         ELSE 'PARTIAL'
       END
       WHERE "orderState" IS NULL OR "orderState" = ''`,
    );
    await this.db.query('UPDATE orders SET "surchargeAmount" = 0 WHERE "surchargeAmount" IS NULL');
    await this.db.query('UPDATE order_items SET "baseUnitPrice" = "unitPrice" WHERE "baseUnitPrice" IS NULL');

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS order_logs (
        id text PRIMARY KEY,
        "orderId" text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        action text NOT NULL,
        detail text,
        "snapshot" jsonb,
        "createdBy" text REFERENCES users(id) ON DELETE SET NULL,
        "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.schemaReady = true;
  }

  private async logAction(executor: OrdersExecutor, params: {
    orderId: string;
    action: 'CREATE_DRAFT' | 'UPDATE_ORDER' | 'DELETE_ORDER' | 'PAY_PARTIAL' | 'PAY_FULL' | 'PRINT_ORDER';
    detail?: string;
    snapshot?: unknown;
    userId: string;
  }) {
    await executor.query(
      `INSERT INTO order_logs (id, "orderId", action, detail, snapshot, "createdBy", "createdAt")
       VALUES ($1, $2, $3, $4, CAST($5 AS jsonb), $6, NOW())`,
      [
        randomUUID(),
        params.orderId,
        params.action,
        params.detail || null,
        JSON.stringify(params.snapshot ?? null),
        params.userId,
      ],
    );
  }

  private normalizeOrderItems(items: CreateOrderInput['billItems']): NormalizedOrderItem[] {
    const rows = Array.isArray(items) ? items : [];
    return rows
      .map((item) => {
        const quantity = Math.max(1, Math.round(Number(item.quantity) || 0));
        const baseUnitPrice = Math.max(0, Number(item.baseUnitPrice ?? item.unitPrice) || 0);
        const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
        const lineTotal = quantity * unitPrice;
        return {
          lineId: item.lineId,
          productId: item.productId,
          productName: item.productName,
          unit: item.unit,
          baseUnitPrice,
          unitPrice,
          quantity,
          note: item.note || '',
          lineTotal,
        };
      })
      .filter((item) => item.productId);
  }

  private async replaceOrderItems(executor: OrdersExecutor, orderId: string, items: NormalizedOrderItem[]) {
    await executor.query('DELETE FROM order_items WHERE "orderId" = $1', [orderId]);
    for (const item of items) {
      await executor.query(
        `INSERT INTO order_items (id, "orderId", "productId", quantity, "baseUnitPrice", "unitPrice", "totalPrice", note, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
        [randomUUID(), orderId, item.productId, item.quantity, item.baseUnitPrice, item.unitPrice, item.lineTotal, item.note || null],
      );
    }
  }

  async listOrders(user: CurrentUser, params: {
    branchId?: string;
    page?: number;
    pageSize?: number;
    search?: string;
    statuses?: string[];
    areaId?: string;
    roomId?: string;
    tableId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    await this.ensureSchema();
    const scopedBranchId = this.branchPolicy.resolveReadBranchId(user, params.branchId);
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(params.pageSize) || 10));
    const offset = (page - 1) * pageSize;
    const search = params.search?.trim() || null;
    const statuses = Array.isArray(params.statuses) && params.statuses.length > 0 ? params.statuses : null;
    const areaId = params.areaId || null;
    const roomId = params.roomId || null;
    const tableId = params.tableId || null;
    const startDateIso = params.startDate ? new Date(params.startDate).toISOString() : null;
    const endDateIso = params.endDate ? new Date(params.endDate).toISOString() : null;

    const countRows = await this.db.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM orders od
       LEFT JOIN users u ON u.id = od."userId"
       LEFT JOIN tables t ON t.id = od."tableId"
       LEFT JOIN areas a ON a.id = t."areaId"
       LEFT JOIN rooms r ON r.id = t."roomId"
       LEFT JOIN rooms rr ON rr.id = od."roomId"
       LEFT JOIN areas ar ON ar.id = rr."areaId"
       WHERE ($1::text IS NULL OR od."branchId" = $1)
         AND ($2::text IS NULL OR (
            od."orderCode" ILIKE CONCAT('%', $2, '%') OR
            COALESCE(a.name, ar.name, '') ILIKE CONCAT('%', $2, '%') OR
            COALESCE(r.name, rr.name, '') ILIKE CONCAT('%', $2, '%') OR
            COALESCE(t.name, '') ILIKE CONCAT('%', $2, '%') OR
            COALESCE(od."customerName", '') ILIKE CONCAT('%', $2, '%') OR
            COALESCE(u."fullName", u.username, '') ILIKE CONCAT('%', $2, '%')
         ))
         AND ($3::text[] IS NULL OR od."orderState" = ANY($3))
         AND ($4::text IS NULL OR COALESCE(a.id, ar.id) = $4)
         AND ($5::text IS NULL OR COALESCE(r.id, rr.id) = $5)
         AND ($6::text IS NULL OR t.id = $6)
         AND ($7::timestamptz IS NULL OR od."createdAt" >= $7)
         AND ($8::timestamptz IS NULL OR od."createdAt" <= $8)`,
      [scopedBranchId || null, search, statuses, areaId, roomId, tableId, startDateIso, endDateIso],
    );
    const total = Number(countRows[0]?.total || 0);
    const rows = await this.db.query<{
      id: string;
      code: string;
      "tableName": string;
      "areaName": string;
      "roomName": string | null;
      "customerName": string | null;
      "totalAmount": string;
      "finalAmount": string;
      "paidAmount": string;
      "creatorName": string | null;
      status: 'DRAFT' | 'PAID' | 'DELETED' | 'PARTIAL';
      "createdAt": string;
    }>(
      `SELECT od.id,
              od."orderCode" AS code,
              t.name AS "tableName",
              COALESCE(a.name, ar.name) AS "areaName",
              COALESCE(r.name, rr.name) AS "roomName",
              od."customerName",
              od."totalAmount"::text AS "totalAmount",
              od."finalAmount"::text AS "finalAmount",
              od."paidAmount"::text AS "paidAmount",
              COALESCE(NULLIF(u."fullName", ''), u.username, od."userId") AS "creatorName",
              od."orderState" AS status,
              od."createdAt"
       FROM orders od
       LEFT JOIN users u ON u.id = od."userId"
       LEFT JOIN tables t ON t.id = od."tableId"
       LEFT JOIN areas a ON a.id = t."areaId"
       LEFT JOIN rooms r ON r.id = t."roomId"
       LEFT JOIN rooms rr ON rr.id = od."roomId"
       LEFT JOIN areas ar ON ar.id = rr."areaId"
       WHERE ($1::text IS NULL OR od."branchId" = $1)
         AND ($2::text IS NULL OR (
            od."orderCode" ILIKE CONCAT('%', $2, '%') OR
            COALESCE(a.name, ar.name, '') ILIKE CONCAT('%', $2, '%') OR
            COALESCE(r.name, rr.name, '') ILIKE CONCAT('%', $2, '%') OR
            COALESCE(t.name, '') ILIKE CONCAT('%', $2, '%') OR
            COALESCE(od."customerName", '') ILIKE CONCAT('%', $2, '%') OR
            COALESCE(u."fullName", u.username, '') ILIKE CONCAT('%', $2, '%')
         ))
         AND ($3::text[] IS NULL OR od."orderState" = ANY($3))
         AND ($4::text IS NULL OR COALESCE(a.id, ar.id) = $4)
         AND ($5::text IS NULL OR COALESCE(r.id, rr.id) = $5)
         AND ($6::text IS NULL OR t.id = $6)
         AND ($7::timestamptz IS NULL OR od."createdAt" >= $7)
         AND ($8::timestamptz IS NULL OR od."createdAt" <= $8)
       ORDER BY od."createdAt" DESC
       LIMIT $9 OFFSET $10`,
      [scopedBranchId || null, search, statuses, areaId, roomId, tableId, startDateIso, endDateIso, pageSize, offset],
    );

    return {
      items: rows.map((row) => {
      const locationParts = [row.areaName || '', row.roomName || '', row.tableName || ''].filter((part) => part && part.trim());
      return {
      id: row.id,
      code: row.code,
      tableName: locationParts.length > 0 ? locationParts.join(' / ') : '-',
      customerName: row.customerName,
      totalAmount: Number(row.totalAmount || 0),
      finalAmount: Number(row.finalAmount || 0),
      paidAmount: Number(row.paidAmount || 0),
      creatorName: row.creatorName || '-',
      status: row.status,
      createdAt: row.createdAt,
      };
      }),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async createOrder(user: CurrentUser, input: CreateOrderInput) {
    await this.ensureSchema();
    if (input.entityType !== 'TABLE' && input.entityType !== 'ROOM') {
      throw new BadRequestException('Loại đối tượng hóa đơn không hợp lệ');
    }

    let resourceBranchId: string | null = null;
    if (input.entityType === 'TABLE') {
      if (!input.tableId) throw new BadRequestException('Bàn là bắt buộc');
      const tableRows = await this.db.query<{ id: string; "branchId": string | null }>(
        'SELECT id, "branchId" FROM tables WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
        [input.tableId],
      );
      if (!tableRows[0]) throw new NotFoundException('Bàn không tồn tại');
      this.branchPolicy.assertResourceBranchAccess(user, tableRows[0].branchId);
      resourceBranchId = tableRows[0].branchId;
    }
    if (input.entityType === 'ROOM') {
      if (!input.roomId) throw new BadRequestException('Phòng là bắt buộc');
      const roomRows = await this.db.query<{ id: string; "branchId": string | null }>(
        'SELECT id, "branchId" FROM rooms WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
        [input.roomId],
      );
      if (!roomRows[0]) throw new NotFoundException('Phòng không tồn tại');
      this.branchPolicy.assertResourceBranchAccess(user, roomRows[0].branchId);
      resourceBranchId = roomRows[0].branchId;
    }

    const branchId = this.branchPolicy.resolveWriteBranchId(user, input.branchId ?? resourceBranchId);
    if (!branchId) throw new BadRequestException('Vui lòng chọn chi nhánh trước khi tạo hóa đơn');
    if (resourceBranchId && resourceBranchId !== branchId) {
      throw new BadRequestException('Đối tượng không thuộc chi nhánh đang chọn');
    }
    const billItems = this.normalizeOrderItems(input.billItems);
    if (billItems.length === 0) throw new BadRequestException('Hóa đơn phải có ít nhất một món');
    const subtotalAmount = billItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const discountAmount = Math.min(subtotalAmount, Math.max(0, Number(input.discountAmount) || 0));
    const surchargeAmount = Math.max(0, Number(input.surchargeAmount) || 0);
    const totalAmount = Math.max(0, subtotalAmount - discountAmount + surchargeAmount);

    const id = randomUUID();
    let orderCode = '';
    const paidAmount = 0;
    await this.db.withTransaction(async (tx) => {
      await tx.query('LOCK TABLE orders IN SHARE ROW EXCLUSIVE MODE');
      orderCode = await this.generateNextOrderCode(tx, new Date());

      await tx.query(
         `INSERT INTO orders (
           id, "orderCode", "tableId", "userId", "totalAmount", "discountAmount", "surchargeAmount", "finalAmount",
          "orderState", "customerName", "paidAmount", "branchId", "roomId", "createdAt", "updatedAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())`,
        [
          id,
          orderCode,
        input.entityType === 'TABLE' ? input.tableId : null,
        user.id,
          subtotalAmount,
          discountAmount,
          surchargeAmount,
          totalAmount,
          'DRAFT',
          input.customerName || null,
          paidAmount,
          branchId,
          input.entityType === 'ROOM' ? input.roomId || null : null,
        ],
      );

      await this.replaceOrderItems(tx, id, billItems);

      await this.logAction(tx, {
        orderId: id,
        action: 'CREATE_DRAFT',
        detail: 'Lưu nháp hóa đơn',
        snapshot: {
          subtotalAmount,
          discountAmount,
          surchargeAmount,
          totalAmount,
          itemCount: billItems.length,
          customerName: input.customerName || null,
        },
        userId: user.id,
      });
    });

    return { id, code: orderCode };
  }

  async getOrderById(user: CurrentUser, id: string) {
    await this.ensureSchema();
    const rows = await this.db.query<{
      id: string;
      code: string;
      tableId: string | null;
      roomId: string | null;
      tableName: string | null;
      areaName: string | null;
      roomName: string | null;
      customerName: string | null;
      discountAmount: string;
      surchargeAmount: string;
      totalAmount: string;
      finalAmount: string;
      paidAmount: string;
      status: 'DRAFT' | 'PAID' | 'DELETED' | 'PARTIAL';
      branchId: string | null;
      createdAt: string;
    }>(
      `SELECT od.id,
              od."orderCode" AS code,
              od."tableId" AS "tableId",
              od."roomId" AS "roomId",
              t.name AS "tableName",
              COALESCE(a.name, ar.name) AS "areaName",
              COALESCE(r.name, rr.name) AS "roomName",
              od."customerName" AS "customerName",
              od."discountAmount"::text AS "discountAmount",
              od."surchargeAmount"::text AS "surchargeAmount",
              od."totalAmount"::text AS "totalAmount",
              od."finalAmount"::text AS "finalAmount",
              od."paidAmount"::text AS "paidAmount",
              od."orderState" AS status,
              od."branchId" AS "branchId",
              od."createdAt"
       FROM orders od
       LEFT JOIN tables t ON t.id = od."tableId"
       LEFT JOIN areas a ON a.id = t."areaId"
       LEFT JOIN rooms r ON r.id = t."roomId"
       LEFT JOIN rooms rr ON rr.id = od."roomId"
       LEFT JOIN areas ar ON ar.id = rr."areaId"
       WHERE od.id = $1
       LIMIT 1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Hóa đơn không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, rows[0].branchId);

    const itemRows = await this.db.query<{
      id: string;
      productId: string;
      quantity: number;
      baseUnitPrice: string;
      unitPrice: string;
      note: string | null;
      productName: string;
      unit: string | null;
    }>(
      `SELECT oi.id,
              oi."productId" AS "productId",
              oi.quantity,
              oi."baseUnitPrice"::text AS "baseUnitPrice",
              oi."unitPrice"::text AS "unitPrice",
              oi.note,
              p.name AS "productName",
              p.unit AS unit
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi."productId"
       WHERE oi."orderId" = $1
       ORDER BY oi."createdAt" ASC`,
      [id],
    );

    const locationParts = [rows[0].areaName || '', rows[0].roomName || '', rows[0].tableName || ''].filter((v) => v && v.trim());
    return {
      id: rows[0].id,
      code: rows[0].code,
      entityType: rows[0].tableId ? 'TABLE' : 'ROOM',
      tableId: rows[0].tableId,
      roomId: rows[0].roomId,
      areaName: rows[0].areaName,
      roomName: rows[0].roomName,
      tableName: rows[0].tableName,
      locationLabel: locationParts.join(' / '),
      customerName: rows[0].customerName,
      discountAmount: Number(rows[0].discountAmount || 0),
      surchargeAmount: Number(rows[0].surchargeAmount || 0),
      totalAmount: Number(rows[0].totalAmount || 0),
      finalAmount: Number(rows[0].finalAmount || 0),
      paidAmount: Number(rows[0].paidAmount || 0),
      status: rows[0].status,
      createdAt: rows[0].createdAt,
      items: itemRows.map((item) => {
        const baseUnitPrice = Number(item.baseUnitPrice || 0);
        const unitPrice = Number(item.unitPrice || 0);
        const quantity = Number(item.quantity || 0);
        const baseAmount = baseUnitPrice * quantity;
        const actualAmount = unitPrice * quantity;
        const lineDiscountAmount = baseAmount > actualAmount ? baseAmount - actualAmount : 0;
        const lineSurchargeAmount = actualAmount > baseAmount ? actualAmount - baseAmount : 0;
        return {
          lineId: item.id,
          productId: item.productId,
          productName: item.productName || '-',
          unit: item.unit || undefined,
          baseUnitPrice,
          unitPrice,
          quantity,
          lineDiscountAmount,
          lineSurchargeAmount,
          note: item.note || '',
        };
      }),
    };
  }

  async updateOrder(user: CurrentUser, id: string, input: UpdateOrderInput) {
    await this.ensureSchema();
    const rows = await this.db.query<{
      id: string;
      "branchId": string | null;
      "orderState": string;
      "finalAmount": string;
      "totalAmount": string;
      "discountAmount": string;
      "surchargeAmount": string;
      "tableId": string | null;
      "roomId": string | null;
    }>(
      'SELECT id, "branchId", "orderState", "finalAmount", "totalAmount", "discountAmount", "surchargeAmount", "tableId", "roomId" FROM orders WHERE id = $1 LIMIT 1',
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Hóa đơn không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, rows[0].branchId);
    if (rows[0].orderState === 'DELETED') {
      throw new BadRequestException('Không thể cập nhật hóa đơn đã xóa');
    }

    let nextTableId: string | null | undefined;
    let nextRoomId: string | null | undefined;
    if (input.entityType) {
      if (input.entityType === 'TABLE') {
        if (!input.tableId) throw new BadRequestException('Bàn là bắt buộc');
        const tableRows = await this.db.query<{ id: string; "branchId": string | null }>(
          'SELECT id, "branchId" FROM tables WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
          [input.tableId],
        );
        if (!tableRows[0]) throw new NotFoundException('Bàn không tồn tại');
        this.branchPolicy.assertResourceBranchAccess(user, tableRows[0].branchId);
        nextTableId = input.tableId;
        nextRoomId = null;
      } else {
        if (!input.roomId) throw new BadRequestException('Phòng là bắt buộc');
        const roomRows = await this.db.query<{ id: string; "branchId": string | null }>(
          'SELECT id, "branchId" FROM rooms WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
          [input.roomId],
        );
        if (!roomRows[0]) throw new NotFoundException('Phòng không tồn tại');
        this.branchPolicy.assertResourceBranchAccess(user, roomRows[0].branchId);
        nextTableId = null;
        nextRoomId = input.roomId;
      }
    }
    const resolvedTableId = nextTableId === undefined ? rows[0].tableId : nextTableId;
    const resolvedRoomId = nextRoomId === undefined ? rows[0].roomId : nextRoomId;

    const normalizedItems = input.billItems === undefined ? undefined : this.normalizeOrderItems(input.billItems);
    const nextSubtotal = normalizedItems
      ? normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0)
      : Number(rows[0].totalAmount || 0);
    const nextDiscountAmount = input.discountAmount === undefined
      ? Number(rows[0].discountAmount || 0)
      : Math.min(nextSubtotal, Math.max(0, Number(input.discountAmount) || 0));
    const nextSurchargeAmount = input.surchargeAmount === undefined
      ? Number(rows[0].surchargeAmount || 0)
      : Math.max(0, Number(input.surchargeAmount) || 0);
    const nextTotal = Math.max(0, nextSubtotal - nextDiscountAmount + nextSurchargeAmount);

    await this.db.withTransaction(async (tx) => {
      await tx.query(
        `UPDATE orders
       SET "customerName" = COALESCE($2, "customerName"),
           "totalAmount" = $3,
           "discountAmount" = $4,
           "surchargeAmount" = $5,
           "finalAmount" = $6,
           "tableId" = $7,
           "roomId" = $8,
           "updatedAt" = NOW()
       WHERE id = $1`,
      [id, input.customerName ?? null, nextSubtotal, nextDiscountAmount, nextSurchargeAmount, nextTotal, resolvedTableId, resolvedRoomId],
      );

      if (normalizedItems) {
        await this.replaceOrderItems(tx, id, normalizedItems);
      }

      await this.logAction(tx, {
        orderId: id,
        action: 'UPDATE_ORDER',
        detail: 'Cập nhật hóa đơn',
        snapshot: {
          customerName: input.customerName ?? undefined,
          subtotalAmount: nextSubtotal,
          discountAmount: nextDiscountAmount,
          surchargeAmount: nextSurchargeAmount,
          totalAmount: nextTotal,
          itemCount: normalizedItems?.length,
        },
        userId: user.id,
      });
    });

    return { success: true };
  }

  async printOrder(user: CurrentUser, id: string) {
    await this.ensureSchema();
    const rows = await this.db.query<{ id: string; "branchId": string | null }>(
      'SELECT id, "branchId" FROM orders WHERE id = $1 LIMIT 1',
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Hóa đơn không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, rows[0].branchId);

    await this.db.withTransaction(async (tx) => {
      await this.logAction(tx, {
        orderId: id,
        action: 'PRINT_ORDER',
        detail: 'In hóa đơn',
        userId: user.id,
      });
    });

    return { success: true };
  }

  async getOrderLogs(user: CurrentUser, id: string) {
    await this.ensureSchema();
    const rows = await this.db.query<{ id: string; "branchId": string | null }>(
      'SELECT id, "branchId" FROM orders WHERE id = $1 LIMIT 1',
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Hóa đơn không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, rows[0].branchId);

    const logs = await this.db.query<{
      id: string;
      action: string;
      detail: string | null;
      snapshot: unknown;
      "createdBy": string | null;
      "createdByName": string | null;
      "createdAt": string;
    }>(
      `SELECT l.id,
              l.action,
              l.detail,
              l.snapshot,
              l."createdBy",
              COALESCE(NULLIF(u."fullName", ''), u.username, l."createdBy") AS "createdByName",
              l."createdAt"
       FROM order_logs l
       LEFT JOIN users u ON u.id = l."createdBy"
        WHERE "orderId" = $1
       ORDER BY l."createdAt" DESC`,
      [id],
    );

    return logs;
  }

  async updatePayment(user: CurrentUser, id: string, paidAmount: number) {
    await this.ensureSchema();
    const rows = await this.db.query<{ id: string; "branchId": string | null; "finalAmount": string }>(
      'SELECT id, "branchId", "finalAmount" FROM orders WHERE id = $1 LIMIT 1',
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Hóa đơn không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, rows[0].branchId);

    const normalizedPaid = Math.max(0, Number(paidAmount) || 0);
    const totalAmount = Number(rows[0].finalAmount || 0);
    const orderState = normalizedPaid >= totalAmount ? 'PAID' : 'PARTIAL';

    await this.db.withTransaction(async (tx) => {
      await tx.query('UPDATE orders SET "paidAmount" = $2, "orderState" = $3, "updatedAt" = NOW() WHERE id = $1', [
        id,
        normalizedPaid,
        orderState,
      ]);

      await this.logAction(tx, {
        orderId: id,
        action: orderState === 'PAID' ? 'PAY_FULL' : 'PAY_PARTIAL',
        detail: `Thanh toán ${normalizedPaid.toLocaleString('vi-VN')}`,
        snapshot: { paidAmount: normalizedPaid, totalAmount, orderState },
        userId: user.id,
      });
    });

    return { id, paidAmount: normalizedPaid, status: orderState };
  }

  async markDeleted(user: CurrentUser, id: string) {
    await this.ensureSchema();
    const rows = await this.db.query<{ id: string; "branchId": string | null }>(
      'SELECT id, "branchId" FROM orders WHERE id = $1 LIMIT 1',
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Hóa đơn không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, rows[0].branchId);

    await this.db.withTransaction(async (tx) => {
      await tx.query('UPDATE orders SET "orderState" = $2, "updatedAt" = NOW() WHERE id = $1', [
        id,
        'DELETED',
      ]);

      await this.logAction(tx, {
        orderId: id,
        action: 'DELETE_ORDER',
        detail: 'Đánh dấu xóa hóa đơn',
        userId: user.id,
      });
    });

    return { success: true };
  }
}
