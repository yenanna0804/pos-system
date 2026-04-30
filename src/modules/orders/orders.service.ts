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
  discountMode?: 'percent' | 'amount';
  discountValue?: number;
  surchargeAmount?: number;
  surchargeMode?: 'percent' | 'amount';
  surchargeValue?: number;
  paidAmount?: number;
  paymentMethod?: 'CASH' | 'BANKING';
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
  discountMode?: 'percent' | 'amount';
  discountValue?: number;
  surchargeAmount?: number;
  surchargeMode?: 'percent' | 'amount';
  surchargeValue?: number;
  paidAmount?: number;
  paymentMethod?: 'CASH' | 'BANKING';
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

type AdjustmentMode = 'percent' | 'amount';
type PaymentMethod = 'CASH' | 'BANKING';

@Injectable()
export class OrdersService {
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

  private toMoney(value: unknown) {
    return Math.max(0, Math.trunc(Number(value) || 0));
  }

  private toRawAdjustmentValue(value: unknown) {
    const numeric = Math.max(0, Number(value) || 0);
    return Number(numeric.toFixed(4));
  }

  private normalizeAdjustmentMode(value: unknown, fallback: AdjustmentMode = 'amount'): AdjustmentMode {
    if (value === 'percent' || value === 'amount') return value;
    return fallback;
  }

  private normalizePaymentMethod(value: unknown, fallback: PaymentMethod = 'CASH'): PaymentMethod {
    if (value === 'CASH' || value === 'BANKING') return value;
    return fallback;
  }

  private async generateNextOrderCode(executor: OrdersExecutor, date: Date) {
    const prefix = this.buildOrderCodePrefix(date);
    const rows = await executor.query<{ nextSeq: string }>(
      `SELECT nextval('public.orders_order_code_seq')::text AS "nextSeq"`,
    );
    const nextSeq = Number(rows[0]?.nextSeq || 1);
    return `${prefix}${nextSeq}`;
  }

  private async logAction(executor: OrdersExecutor, params: {
    orderId: string;
    action: 'CREATE_ORDER' | 'UPDATE_ORDER' | 'DELETE_ORDER' | 'PAY_PARTIAL' | 'PAY_FULL' | 'PRINT_ORDER';
    detail?: string;
    snapshot?: unknown;
    userId: string;
  }) {
    await executor.query(
      `INSERT INTO order_logs (id, "orderId", action, detail, snapshot, "createdBy", "createdAt")
       VALUES ($1, $2, $3::"OrderLogAction", $4, CAST($5 AS jsonb), $6, NOW())`,
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
        const baseUnitPrice = this.toMoney(item.baseUnitPrice ?? item.unitPrice);
        const unitPrice = this.toMoney(item.unitPrice);
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
    orderStates?: string[];
    paymentMethod?: 'CASH' | 'BANKING';
    areaId?: string;
    roomId?: string;
    tableId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const scopedBranchId = this.branchPolicy.resolveReadBranchId(user, params.branchId);
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(params.pageSize) || 10));
    const offset = (page - 1) * pageSize;
    const search = params.search?.trim() || null;
    const orderStates = Array.isArray(params.orderStates) && params.orderStates.length > 0 ? params.orderStates : null;
    const paymentMethod = params.paymentMethod ? this.normalizePaymentMethod(params.paymentMethod, 'CASH') : null;
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
         AND ($3::text[] IS NULL OR od."orderState"::text = ANY($3))
          AND ($4::"PaymentMethod" IS NULL OR od."paymentMethod" = $4)
          AND ($5::text IS NULL OR COALESCE(a.id, ar.id) = $5)
          AND ($6::text IS NULL OR COALESCE(r.id, rr.id) = $6)
          AND ($7::text IS NULL OR t.id = $7)
          AND ($8::timestamptz IS NULL OR od."createdAt" >= $8)
          AND ($9::timestamptz IS NULL OR od."createdAt" <= $9)`,
        [scopedBranchId || null, search, orderStates, paymentMethod, areaId, roomId, tableId, startDateIso, endDateIso],
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
      "paymentMethod": PaymentMethod | null;
      "creatorName": string | null;
      orderState: 'PAID' | 'DELETED' | 'PARTIAL';
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
               od."paymentMethod"::text AS "paymentMethod",
               COALESCE(NULLIF(u."fullName", ''), u.username, od."userId") AS "creatorName",
              od."orderState" AS "orderState",
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
         AND ($3::text[] IS NULL OR od."orderState"::text = ANY($3))
          AND ($4::"PaymentMethod" IS NULL OR od."paymentMethod" = $4)
          AND ($5::text IS NULL OR COALESCE(a.id, ar.id) = $5)
          AND ($6::text IS NULL OR COALESCE(r.id, rr.id) = $6)
          AND ($7::text IS NULL OR t.id = $7)
          AND ($8::timestamptz IS NULL OR od."createdAt" >= $8)
          AND ($9::timestamptz IS NULL OR od."createdAt" <= $9)
        ORDER BY od."createdAt" DESC
        LIMIT $10 OFFSET $11`,
        [scopedBranchId || null, search, orderStates, paymentMethod, areaId, roomId, tableId, startDateIso, endDateIso, pageSize, offset],
    );

    return {
      items: rows.map((row) => {
      const locationParts = [row.areaName || '', row.roomName || '', row.tableName || ''].filter((part) => part && part.trim());
      return {
      id: row.id,
      code: row.code,
      tableName: locationParts.length > 0 ? locationParts.join(' / ') : '-',
      customerName: row.customerName,
      totalAmount: this.toMoney(row.totalAmount),
      finalAmount: this.toMoney(row.finalAmount),
      paidAmount: this.toMoney(row.paidAmount),
      paymentMethod: row.paymentMethod,
      creatorName: row.creatorName || '-',
      orderState: row.orderState,
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
    const discountMode = this.normalizeAdjustmentMode(input.discountMode, 'amount');
    const surchargeMode = this.normalizeAdjustmentMode(input.surchargeMode, 'amount');
    const discountValue = this.toRawAdjustmentValue(input.discountValue ?? input.discountAmount);
    const surchargeValue = this.toRawAdjustmentValue(input.surchargeValue ?? input.surchargeAmount);
    const discountAmount = discountMode === 'percent'
      ? this.toMoney(Math.min(subtotalAmount, (subtotalAmount * discountValue) / 100))
      : Math.min(subtotalAmount, this.toMoney(discountValue));
    const subtotalAfterDiscount = Math.max(0, subtotalAmount - discountAmount);
    const surchargeAmount = surchargeMode === 'percent'
      ? this.toMoney((subtotalAfterDiscount * surchargeValue) / 100)
      : this.toMoney(surchargeValue);
    const totalAmount = Math.max(0, subtotalAmount - discountAmount + surchargeAmount);

    const id = randomUUID();
    let orderCode = '';
    const normalizedPaidAmount = this.toMoney(input.paidAmount);
    const paidAmount = Math.min(normalizedPaidAmount, totalAmount);
    const paymentMethod = this.normalizePaymentMethod(input.paymentMethod, 'CASH');
    const orderState = paidAmount >= totalAmount ? 'PAID' : 'PARTIAL';

    await this.db.withTransaction(async (tx) => {
      orderCode = await this.generateNextOrderCode(tx, new Date());

      await tx.query(
         `INSERT INTO orders (
           id, "orderCode", "tableId", "userId", "totalAmount", "discountAmount", "discountMode", "discountValue", "surchargeAmount", "surchargeMode", "surchargeValue", "finalAmount",
            "orderState", "customerName", "paidAmount", "paymentMethod", "branchId", "roomId", "createdAt", "updatedAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::"OrderAdjustmentMode", $8, $9, $10::"OrderAdjustmentMode", $11, $12, $13::"OrderLifecycleState", $14, $15, $16::"PaymentMethod", $17, $18, NOW(), NOW())`,
        [
          id,
          orderCode,
        input.entityType === 'TABLE' ? input.tableId : null,
        user.id,
          subtotalAmount,
          discountAmount,
          discountMode,
          discountValue,
          surchargeAmount,
          surchargeMode,
          surchargeValue,
          totalAmount,
          orderState,
          input.customerName || null,
          paidAmount,
          paymentMethod,
          branchId,
          input.entityType === 'ROOM' ? input.roomId || null : null,
        ],
      );

      await this.replaceOrderItems(tx, id, billItems);

      await this.logAction(tx, {
        orderId: id,
        action: 'CREATE_ORDER',
        detail: 'Tạo hóa đơn',
        snapshot: {
          subtotalAmount,
          discountAmount,
          discountMode,
          discountValue,
          surchargeAmount,
          surchargeMode,
          surchargeValue,
          totalAmount,
          paidAmount,
          paymentMethod,
          orderState,
          itemCount: billItems.length,
          customerName: input.customerName || null,
        },
        userId: user.id,
      });
    });

    return { id, code: orderCode };
  }

  async getOrderById(user: CurrentUser, id: string) {
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
      discountMode: AdjustmentMode;
      discountValue: string;
      surchargeAmount: string;
      surchargeMode: AdjustmentMode;
      surchargeValue: string;
      totalAmount: string;
      finalAmount: string;
      paidAmount: string;
      paymentMethod: PaymentMethod | null;
      orderState: 'PAID' | 'DELETED' | 'PARTIAL';
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
              od."discountMode"::text AS "discountMode",
              od."discountValue"::text AS "discountValue",
              od."surchargeAmount"::text AS "surchargeAmount",
              od."surchargeMode"::text AS "surchargeMode",
              od."surchargeValue"::text AS "surchargeValue",
              od."totalAmount"::text AS "totalAmount",
              od."finalAmount"::text AS "finalAmount",
               od."paidAmount"::text AS "paidAmount",
               od."paymentMethod"::text AS "paymentMethod",
               od."orderState" AS "orderState",
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
      discountAmount: this.toMoney(rows[0].discountAmount),
      discountMode: this.normalizeAdjustmentMode(rows[0].discountMode, 'amount'),
      discountValue: this.toRawAdjustmentValue(rows[0].discountValue),
      surchargeAmount: this.toMoney(rows[0].surchargeAmount),
      surchargeMode: this.normalizeAdjustmentMode(rows[0].surchargeMode, 'amount'),
      surchargeValue: this.toRawAdjustmentValue(rows[0].surchargeValue),
      totalAmount: this.toMoney(rows[0].totalAmount),
      finalAmount: this.toMoney(rows[0].finalAmount),
      paidAmount: this.toMoney(rows[0].paidAmount),
      paymentMethod: rows[0].paymentMethod,
      orderState: rows[0].orderState,
      createdAt: rows[0].createdAt,
      items: itemRows.map((item) => {
         const baseUnitPrice = this.toMoney(item.baseUnitPrice);
         const unitPrice = this.toMoney(item.unitPrice);
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
    const rows = await this.db.query<{
      id: string;
      "branchId": string | null;
      "customerName": string | null;
      "orderState": string;
      "paidAmount": string;
      "paymentMethod": PaymentMethod | null;
      "finalAmount": string;
      "totalAmount": string;
      "discountAmount": string;
      "discountMode": AdjustmentMode;
      "discountValue": string;
      "surchargeAmount": string;
      "surchargeMode": AdjustmentMode;
      "surchargeValue": string;
      "tableId": string | null;
      "roomId": string | null;
    }>(
      'SELECT id, "branchId", "customerName", "orderState", "paidAmount", "paymentMethod", "finalAmount", "totalAmount", "discountAmount", "discountMode", "discountValue", "surchargeAmount", "surchargeMode", "surchargeValue", "tableId", "roomId" FROM orders WHERE id = $1 LIMIT 1',
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
      : this.toMoney(rows[0].totalAmount);
    const currentDiscountMode = this.normalizeAdjustmentMode(rows[0].discountMode, 'amount');
    const currentSurchargeMode = this.normalizeAdjustmentMode(rows[0].surchargeMode, 'amount');

    const nextDiscountMode = this.normalizeAdjustmentMode(
      input.discountMode,
      input.discountAmount !== undefined && input.discountValue === undefined ? 'amount' : currentDiscountMode,
    );
    const nextSurchargeMode = this.normalizeAdjustmentMode(
      input.surchargeMode,
      input.surchargeAmount !== undefined && input.surchargeValue === undefined ? 'amount' : currentSurchargeMode,
    );

    const nextDiscountValue = this.toRawAdjustmentValue(
      input.discountValue ?? input.discountAmount ?? rows[0].discountValue,
    );
    const nextSurchargeValue = this.toRawAdjustmentValue(
      input.surchargeValue ?? input.surchargeAmount ?? rows[0].surchargeValue,
    );

    const nextDiscountAmount = nextDiscountMode === 'percent'
      ? this.toMoney(Math.min(nextSubtotal, (nextSubtotal * nextDiscountValue) / 100))
      : Math.min(nextSubtotal, this.toMoney(nextDiscountValue));
    const nextSubtotalAfterDiscount = Math.max(0, nextSubtotal - nextDiscountAmount);
    const nextSurchargeAmount = nextSurchargeMode === 'percent'
      ? this.toMoney((nextSubtotalAfterDiscount * nextSurchargeValue) / 100)
      : this.toMoney(nextSurchargeValue);
    const nextTotal = Math.max(0, nextSubtotal - nextDiscountAmount + nextSurchargeAmount);
    const nextPaidAmount = input.paidAmount === undefined
      ? this.toMoney(rows[0].paidAmount)
      : this.toMoney(input.paidAmount);
    const nextPaymentMethod = input.paymentMethod === undefined
      ? this.normalizePaymentMethod(rows[0].paymentMethod, 'CASH')
      : this.normalizePaymentMethod(input.paymentMethod, 'CASH');
    const shouldSoftDelete = normalizedItems !== undefined && normalizedItems.length === 0;
    const nextOrderState = shouldSoftDelete ? 'DELETED' : (nextPaidAmount >= nextTotal ? 'PAID' : 'PARTIAL');

    const formatMoney = (value: number) => this.toMoney(value).toLocaleString('vi-VN');
    const stateLabel = (state: string) => {
      if (state === 'PAID') return 'Đã thanh toán';
      if (state === 'PARTIAL') return 'Chưa trả hết';
      if (state === 'DELETED') return 'Đã xóa';
      return state;
    };

    const changeMessages: string[] = [];
    const previousCustomerName = rows[0].customerName ?? '';
    const nextCustomerName = input.customerName ?? previousCustomerName;
    if (nextCustomerName !== previousCustomerName) {
      changeMessages.push(`Tên khách hàng: ${previousCustomerName || '-'} -> ${nextCustomerName || '-'}`);
    }
    if (nextSubtotal !== this.toMoney(rows[0].totalAmount)) {
      changeMessages.push(`tạm tính: ${formatMoney(this.toMoney(rows[0].totalAmount))} -> ${formatMoney(nextSubtotal)}`);
    }
    if (nextDiscountAmount !== this.toMoney(rows[0].discountAmount)) {
      changeMessages.push(`giảm giá: ${formatMoney(this.toMoney(rows[0].discountAmount))} -> ${formatMoney(nextDiscountAmount)}`);
    }
    if (nextDiscountMode !== currentDiscountMode || nextDiscountValue !== this.toRawAdjustmentValue(rows[0].discountValue)) {
      changeMessages.push(`kiểu giảm giá: ${currentDiscountMode}(${this.toRawAdjustmentValue(rows[0].discountValue)}) -> ${nextDiscountMode}(${nextDiscountValue})`);
    }
    if (nextSurchargeAmount !== this.toMoney(rows[0].surchargeAmount)) {
      changeMessages.push(`phụ phí: ${formatMoney(this.toMoney(rows[0].surchargeAmount))} -> ${formatMoney(nextSurchargeAmount)}`);
    }
    if (nextSurchargeMode !== currentSurchargeMode || nextSurchargeValue !== this.toRawAdjustmentValue(rows[0].surchargeValue)) {
      changeMessages.push(`kiểu phụ phí: ${currentSurchargeMode}(${this.toRawAdjustmentValue(rows[0].surchargeValue)}) -> ${nextSurchargeMode}(${nextSurchargeValue})`);
    }
    if (nextTotal !== this.toMoney(rows[0].finalAmount)) {
      changeMessages.push(`phải thanh toán: ${formatMoney(this.toMoney(rows[0].finalAmount))} -> ${formatMoney(nextTotal)}`);
    }
    if (nextPaidAmount !== this.toMoney(rows[0].paidAmount)) {
      changeMessages.push(`khách thanh toán: ${formatMoney(this.toMoney(rows[0].paidAmount))} -> ${formatMoney(nextPaidAmount)}`);
    }
    if (nextPaymentMethod !== this.normalizePaymentMethod(rows[0].paymentMethod, 'CASH')) {
      changeMessages.push(`phương thức thanh toán: ${this.normalizePaymentMethod(rows[0].paymentMethod, 'CASH')} -> ${nextPaymentMethod}`);
    }
    if (nextOrderState !== rows[0].orderState) {
      changeMessages.push(`trạng thái: ${stateLabel(rows[0].orderState)} -> ${stateLabel(nextOrderState)}`);
    }
    if (resolvedTableId !== rows[0].tableId || resolvedRoomId !== rows[0].roomId) {
      changeMessages.push('phòng/bàn: đã thay đổi');
    }
    if (normalizedItems) {
      changeMessages.push(`danh sách món: ${normalizedItems.length} dòng`);
    }

    const updateDetail = shouldSoftDelete
      ? 'Đánh dấu xóa hóa đơn do không còn món'
      : (changeMessages.length ? `Cập nhật hóa đơn: ${changeMessages.join('; ')}` : 'Cập nhật hóa đơn');

    await this.db.withTransaction(async (tx) => {
      await tx.query(
        `UPDATE orders
       SET "customerName" = COALESCE($2, "customerName"),
           "totalAmount" = $3,
           "discountAmount" = $4,
           "discountMode" = $5::"OrderAdjustmentMode",
           "discountValue" = $6,
           "surchargeAmount" = $7,
           "surchargeMode" = $8::"OrderAdjustmentMode",
           "surchargeValue" = $9,
           "finalAmount" = $10,
           "paidAmount" = $11,
           "paymentMethod" = $12::"PaymentMethod",
           "orderState" = $13::"OrderLifecycleState",
           "tableId" = $14,
           "roomId" = $15,
              "updatedAt" = NOW()
        WHERE id = $1`,
      [
        id,
        input.customerName ?? null,
        nextSubtotal,
        nextDiscountAmount,
        nextDiscountMode,
        nextDiscountValue,
        nextSurchargeAmount,
        nextSurchargeMode,
        nextSurchargeValue,
        nextTotal,
        nextPaidAmount,
        nextPaymentMethod,
        nextOrderState,
        resolvedTableId,
        resolvedRoomId,
      ],
      );

      if (normalizedItems) {
        await this.replaceOrderItems(tx, id, normalizedItems);
      }

      await this.logAction(tx, {
        orderId: id,
        action: shouldSoftDelete ? 'DELETE_ORDER' : 'UPDATE_ORDER',
        detail: updateDetail,
        snapshot: {
          customerName: input.customerName ?? undefined,
          subtotalAmount: nextSubtotal,
          discountAmount: nextDiscountAmount,
          discountMode: nextDiscountMode,
          discountValue: nextDiscountValue,
          surchargeAmount: nextSurchargeAmount,
          surchargeMode: nextSurchargeMode,
          surchargeValue: nextSurchargeValue,
          totalAmount: nextTotal,
          paidAmount: nextPaidAmount,
          paymentMethod: nextPaymentMethod,
          orderState: nextOrderState,
          itemCount: normalizedItems?.length,
        },
        userId: user.id,
      });
    });

    return { success: true };
  }

  async printOrder(user: CurrentUser, id: string) {
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

  async markDeleted(user: CurrentUser, id: string) {
    const rows = await this.db.query<{ id: string; "branchId": string | null }>(
      'SELECT id, "branchId" FROM orders WHERE id = $1 LIMIT 1',
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Hóa đơn không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, rows[0].branchId);

    await this.db.withTransaction(async (tx) => {
      await tx.query('UPDATE orders SET "orderState" = $2::"OrderLifecycleState", "updatedAt" = NOW() WHERE id = $1', [
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

  async hardDelete(user: CurrentUser, id: string) {
    const rows = await this.db.query<{ id: string; "branchId": string | null }>(
      'SELECT id, "branchId" FROM orders WHERE id = $1 LIMIT 1',
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Hóa đơn không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, rows[0].branchId);

    await this.db.query('DELETE FROM orders WHERE id = $1', [id]);

    return { success: true };
  }
}
