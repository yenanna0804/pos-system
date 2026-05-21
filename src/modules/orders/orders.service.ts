import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { QueryResultRow } from 'pg';
import { BranchPolicyService } from '../../common/branch-policy.service';
import type { CurrentUser } from '../../common/auth.types';
import { PgService } from '../../database/pg.service';
import { OrderPricingService, type AdjustmentMode, type PaymentMethod } from './order-pricing.service';

type CreateOrderInput = {
  entityType?: 'TABLE' | 'ROOM';
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
  isDebtMarked?: boolean;
  paymentMethod?: 'CASH' | 'BANKING';
  orderState?: 'DRAFT' | 'PAID' | 'PARTIAL' | 'UNPAID';
  billItems: {
    lineId: string;
    productId: string;
    productName: string;
    unit?: string;
    baseUnitPrice?: number;
    unitPrice: number;
    quantity: number;
    note: string;
    pricingTypeSnapshot?: 'FIXED' | 'TIME';
    timeRateAmountSnapshot?: number;
    timeRateMinutesSnapshot?: number;
    usedMinutes?: number;
    startAt?: string | null;
    stopAt?: string | null;
    lineDiscountAmount?: number;
    lineSurchargeAmount?: number;
  }[];
  branchId?: string;
  applySaveStatusRules?: boolean;
};

type UpdateOrderInput = Partial<CreateOrderInput> & {
  billItemsPatch?: {
    addedItems?: {
      lineId?: string;
      productId: string;
      productName: string;
      unit?: string;
      baseUnitPrice?: number;
      unitPrice: number;
      quantity: number;
      note: string;
      pricingTypeSnapshot?: 'FIXED' | 'TIME';
      timeRateAmountSnapshot?: number;
      timeRateMinutesSnapshot?: number;
      usedMinutes?: number;
      startAt?: string | null;
      stopAt?: string | null;
      lineDiscountAmount?: number;
      lineSurchargeAmount?: number;
    }[];
    updatedItems?: (Partial<CreateOrderInput['billItems'][number]> & { lineId: string })[];
    removedItemIds?: string[];
  };
};

type NormalizedItem = {
  clientLineId: string;
  lineId: string;
  productId: string;
  productName: string;
  unit?: string;
  quantity: number;
  pricingTypeSnapshot: 'FIXED' | 'TIME';
  baseUnitPrice: number;
  unitPrice: number;
  lineTotal: number;
  timeRateAmountSnapshot: number | null;
  timeRateMinutesSnapshot: number | null;
  usedMinutes: number;
  startAt: string | null;
  stopAt: string | null;
  lineDiscountAmount: number;
  lineSurchargeAmount: number;
  note: string;
};

type OrdersExecutor = { query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> };

type ItemLogSnapshot = {
  lineId: string;
  productId: string;
  productName: string;
  pricingTypeSnapshot: 'FIXED' | 'TIME';
  quantity: number;
  baseUnitPrice: number;
  unitPrice: number;
  lineTotal: number;
  lineDiscountAmount: number;
  lineSurchargeAmount: number;
  usedMinutes: number;
  startAt: string | null;
  stopAt: string | null;
  note: string;
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly db: PgService,
    private readonly branchPolicy: BranchPolicyService,
    private readonly pricing: OrderPricingService,
  ) {}

  private toMoney(value: unknown) { return this.pricing.toMoney(value); }
  private toRawAdjustmentValue(value: unknown) { return this.pricing.toRawAdjustmentValue(value); }

  private async cleanupEmptyDraftOrdersForUserBranch(userId: string, branchId: string) {
    await this.db.query(
      `DELETE FROM orders od
       WHERE od."branchId" = $1
         AND od."userId" = $2
         AND od."orderState" = 'DRAFT'::"OrderLifecycleState"
         AND NOT EXISTS (
           SELECT 1
           FROM order_items oi
           WHERE oi."orderId" = od.id
         )`,
      [branchId, userId],
    );
  }
  private normalizeAdjustmentMode(value: unknown, fallback: AdjustmentMode = 'amount') { return this.pricing.normalizeAdjustmentMode(value, fallback); }
  private normalizePaymentMethod(value: unknown, fallback: PaymentMethod = 'CASH') { return this.pricing.normalizePaymentMethod(value, fallback); }
  private calculateTimePrice(rateAmount: number, rateMinutes: number, usedMinutes: number) { return this.pricing.calculateTimePrice(rateAmount, rateMinutes, usedMinutes); }

  private readonly takeawayAreaName = 'Mang về';
  private readonly takeawayTableName = '(Mang về)';

  private isUuid(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
  }

  private resolveLineId(lineId: unknown) {
    if (this.isUuid(lineId)) return lineId.trim().toLowerCase();
    return randomUUID();
  }

  private calculateUsedMinutesFromTimestamps(startAt?: string | null, stopAt?: string | null) {
    if (!startAt || !stopAt) return null;
    const startMs = Date.parse(startAt);
    const stopMs = Date.parse(stopAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(stopMs) || stopMs <= startMs) return 0;
    return Math.ceil((stopMs - startMs) / 60000);
  }

  private async generateOrderCode(executor: OrdersExecutor) {
    const now = new Date(Date.now() + 7 * 3_600_000);
    const yy = String(now.getUTCFullYear()).slice(-2);
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const prefix = `HD${yy}${mm}${dd}`;
    const seq = await executor.query<{ nextSeq: string }>(`SELECT nextval('public.orders_order_code_seq')::text AS "nextSeq"`);
    return `${prefix}${Number(seq[0]?.nextSeq || 1)}`;
  }

  private async logAction(executor: OrdersExecutor, payload: { orderId: string; action: string; detail?: string; snapshot?: unknown; userId: string }) {
    await executor.query(
      `INSERT INTO order_logs (id, "orderId", action, detail, snapshot, "createdBy", "createdAt") VALUES ($1, $2, $3::"OrderLogAction", $4, CAST($5 AS jsonb), $6, NOW())`,
      [randomUUID(), payload.orderId, payload.action, payload.detail || null, JSON.stringify(payload.snapshot ?? null), payload.userId],
    );
  }

  private async resolveResourceBranch(user: CurrentUser, input: { entityType?: 'TABLE' | 'ROOM'; tableId?: string; roomId?: string; branchId?: string }) {
    let resourceBranchId: string | null = null;
    if (input.entityType === 'TABLE') {
      if (!input.tableId) throw new BadRequestException('Bàn là bắt buộc');
      const rows = await this.db.query<{ branchId: string | null }>('SELECT "branchId" AS "branchId" FROM tables WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1', [input.tableId]);
      if (!rows[0]) throw new NotFoundException('Bàn không tồn tại');
      this.branchPolicy.assertResourceBranchAccess(user, rows[0].branchId);
      resourceBranchId = rows[0].branchId;
    }
    if (input.entityType === 'ROOM') {
      if (!input.roomId) throw new BadRequestException('Phòng là bắt buộc');
      const rows = await this.db.query<{ branchId: string | null }>('SELECT "branchId" AS "branchId" FROM rooms WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1', [input.roomId]);
      if (!rows[0]) throw new NotFoundException('Phòng không tồn tại');
      this.branchPolicy.assertResourceBranchAccess(user, rows[0].branchId);
      resourceBranchId = rows[0].branchId;
    }
    const branchId = this.branchPolicy.resolveWriteBranchId(user, input.branchId ?? resourceBranchId);
    if (!branchId) throw new BadRequestException('Vui lòng chọn chi nhánh trước khi tạo hóa đơn');
    if (resourceBranchId && resourceBranchId !== branchId) throw new BadRequestException('Đối tượng không thuộc chi nhánh đang chọn');
    return branchId;
  }

  private async normalizeItems(orderId: string, items: CreateOrderInput['billItems']): Promise<NormalizedItem[]> {
    const raw = Array.isArray(items) ? items : [];
    const productIds = [...new Set(raw.map((i) => i.productId).filter(Boolean))];
    const productRows = productIds.length > 0
      ? await this.db.query<{ id: string; name: string; unit: string | null; type: 'SINGLE' | 'COMBO' | 'TIME'; timeRateAmount: string | null; timeRateMinutes: number | null }>(
        `SELECT id, name, unit, "type", "timeRateAmount"::text AS "timeRateAmount", "timeRateMinutes" AS "timeRateMinutes"
         FROM products WHERE id = ANY($1::text[]) AND "deletedAt" IS NULL`,
        [productIds],
      )
      : [];
    const byProduct = new Map(productRows.map((r) => [r.id, r]));
    const normalized: NormalizedItem[] = [];
    const usedLineIds = new Set<string>();
    for (const item of raw) {
      const product = byProduct.get(item.productId);
      if (!product) continue;
      let lineId = this.resolveLineId(item.lineId);
      if (usedLineIds.has(lineId)) {
        lineId = randomUUID();
      }
      usedLineIds.add(lineId);
      if (product.type === 'TIME' || item.pricingTypeSnapshot === 'TIME') {
        const rateAmount = this.toMoney(item.timeRateAmountSnapshot ?? product.timeRateAmount ?? item.unitPrice);
        const rateMinutes = Math.max(1, Math.trunc(Number(item.timeRateMinutesSnapshot ?? product.timeRateMinutes) || 0));
        const usedMinutesFromTime = this.calculateUsedMinutesFromTimestamps(item.startAt || null, item.stopAt || null);
        const usedMinutes = usedMinutesFromTime != null
          ? Math.max(0, Math.trunc(usedMinutesFromTime))
          : Math.max(0, Math.trunc(Number(item.usedMinutes) || 0));
        const unitPrice = this.toMoney(item.unitPrice ?? rateAmount);
        const baseLineTotal = this.calculateTimePrice(rateAmount, rateMinutes, usedMinutes);
        const actualLineTotal = this.calculateTimePrice(unitPrice, rateMinutes, usedMinutes);
        const timeAdjustmentFactor = usedMinutes / rateMinutes;
        normalized.push({
          clientLineId: String(item.lineId || ''),
          lineId,
          productId: product.id,
          productName: item.productName || product.name,
          unit: item.unit || product.unit || undefined,
          quantity: 1,
          pricingTypeSnapshot: 'TIME',
          baseUnitPrice: rateAmount,
          unitPrice,
          lineTotal: actualLineTotal,
          timeRateAmountSnapshot: rateAmount,
          timeRateMinutesSnapshot: rateMinutes,
          usedMinutes,
          startAt: item.startAt || null,
          stopAt: item.stopAt || null,
          lineDiscountAmount: Math.max(0, this.toMoney((rateAmount - unitPrice) * timeAdjustmentFactor)),
          lineSurchargeAmount: Math.max(0, this.toMoney((unitPrice - rateAmount) * timeAdjustmentFactor)),
          note: item.note || '',
        });
        continue;
      }
      const quantity = Math.max(1, Math.round(Number(item.quantity) || 0));
      const unitPrice = this.toMoney(item.unitPrice);
      const baseUnitPrice = this.toMoney(item.baseUnitPrice ?? unitPrice);
      const baseLineTotal = quantity * baseUnitPrice;
      const actualLineTotal = quantity * unitPrice;
      normalized.push({
        clientLineId: String(item.lineId || ''),
        lineId,
        productId: product.id,
        productName: item.productName || product.name,
        unit: item.unit || product.unit || undefined,
        quantity,
        pricingTypeSnapshot: 'FIXED',
        baseUnitPrice,
        unitPrice,
        lineTotal: actualLineTotal,
        timeRateAmountSnapshot: null,
        timeRateMinutesSnapshot: null,
        usedMinutes: 0,
        startAt: item.startAt || null,
        stopAt: item.stopAt || null,
        lineDiscountAmount: Math.max(0, this.toMoney(baseLineTotal - actualLineTotal)),
        lineSurchargeAmount: Math.max(0, this.toMoney(actualLineTotal - baseLineTotal)),
        note: item.note || '',
      });
    }
    return normalized;
  }

  private async resolveTakeawayTableId(branchId: string) {
    const existingTable = await this.db.query<{ id: string }>(
      `SELECT id FROM tables
       WHERE "deletedAt" IS NULL
         AND "branchId" = $1
         AND name IN ($2, $3, $4)
       ORDER BY CASE WHEN name = $2 THEN 0 ELSE 1 END, "createdAt" ASC
       LIMIT 1`,
      [branchId, this.takeawayTableName, this.takeawayAreaName, 'Mang ve'],
    );
    if (existingTable[0]?.id) return existingTable[0].id;

    const existingArea = await this.db.query<{ id: string }>(
      `SELECT id FROM areas
       WHERE "deletedAt" IS NULL
         AND "branchId" = $1
         AND name IN ($2, $3)
       ORDER BY CASE WHEN name = $2 THEN 0 ELSE 1 END, "createdAt" ASC
       LIMIT 1`,
      [branchId, this.takeawayAreaName, 'Mang ve'],
    );

    const areaId = existingArea[0]?.id || randomUUID();
    if (!existingArea[0]?.id) {
      await this.db.query(
        `INSERT INTO areas (id, name, "branchId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [areaId, this.takeawayAreaName, branchId],
      );
    }

    const tableId = randomUUID();
    await this.db.query(
      `INSERT INTO tables (id, name, capacity, status, "isActive", "branchId", "areaId", "roomId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, CAST($4 AS "TableStatus"), $5, $6, $7, $8, NOW(), NOW())`,
      [tableId, this.takeawayTableName, 1, 'AVAILABLE', true, branchId, areaId, null],
    );
    return tableId;
  }

  private computeOrderTotals(input: {
    itemsSubtotal: number;
    itemDiscountTotal?: unknown;
    discountMode?: unknown;
    discountValue?: unknown;
    discountAmount?: unknown;
    surchargeMode?: unknown;
    surchargeValue?: unknown;
    surchargeAmount?: unknown;
    paidAmount?: unknown;
    isDebtMarked?: unknown;
    orderState?: unknown;
    hasOpenTimeItems?: boolean;
    applyOpenTimeStateRule?: boolean;
  }) {
    const discountMode = this.normalizeAdjustmentMode(input.discountMode, 'amount');
    const surchargeMode = this.normalizeAdjustmentMode(input.surchargeMode, 'amount');
    const discountValue = this.toRawAdjustmentValue(input.discountValue ?? input.discountAmount);
    const surchargeValue = this.toRawAdjustmentValue(input.surchargeValue ?? input.surchargeAmount);
    const subtotalAmount = Math.max(0, this.toMoney(input.itemsSubtotal));
    const invoiceDiscountAmount = discountMode === 'percent'
      ? this.toMoney(Math.min(subtotalAmount, (subtotalAmount * discountValue) / 100))
      : Math.min(subtotalAmount, this.toMoney(discountValue));
    const discountAmount = Math.max(0, this.toMoney(input.itemDiscountTotal ?? 0));
    const surchargeAmount = surchargeMode === 'percent'
      ? this.toMoney((subtotalAmount * surchargeValue) / 100)
      : this.toMoney(surchargeValue);
    const finalAmount = Math.max(0, subtotalAmount - invoiceDiscountAmount + surchargeAmount);
    const paidAmount = Math.max(0, this.toMoney(input.paidAmount));
    const isDebtMarked = Boolean(input.isDebtMarked);
    const forcedOrderState = String(input.orderState || '').toUpperCase();
    const hasOpenTimeItems = Boolean(input.hasOpenTimeItems);
    const applyOpenTimeStateRule = Boolean(input.applyOpenTimeStateRule);
    const orderState = forcedOrderState === 'DRAFT'
      ? 'DRAFT'
      : (isDebtMarked || forcedOrderState === 'PARTIAL')
        ? 'PARTIAL'
      : (paidAmount === 0
          ? (finalAmount === 0 ? 'PAID' : 'UNPAID')
          : (applyOpenTimeStateRule && hasOpenTimeItems ? 'PARTIAL' : (paidAmount >= finalAmount ? 'PAID' : 'PARTIAL')));
    return { subtotalAmount, discountMode, discountValue, discountAmount, surchargeMode, surchargeValue, surchargeAmount, finalAmount, paidAmount, orderState, isDebtMarked };
  }

  private mapItemForSnapshot(item: {
    lineId: string;
    productId: string;
    productName: string;
    pricingTypeSnapshot: 'FIXED' | 'TIME';
    quantity: number;
    baseUnitPrice: number;
    unitPrice: number;
    lineTotal: number;
    lineDiscountAmount: number;
    lineSurchargeAmount: number;
    usedMinutes: number;
    startAt: string | null;
    stopAt: string | null;
    note: string;
  }): ItemLogSnapshot {
    return {
      lineId: item.lineId,
      productId: item.productId,
      productName: item.productName,
      pricingTypeSnapshot: item.pricingTypeSnapshot,
      quantity: item.quantity,
      baseUnitPrice: this.toMoney(item.baseUnitPrice),
      unitPrice: this.toMoney(item.unitPrice),
      lineTotal: this.toMoney(item.lineTotal),
      lineDiscountAmount: this.toMoney(item.lineDiscountAmount),
      lineSurchargeAmount: this.toMoney(item.lineSurchargeAmount),
      usedMinutes: Math.max(0, Math.trunc(Number(item.usedMinutes) || 0)),
      startAt: item.startAt || null,
      stopAt: item.stopAt || null,
      note: item.note || '',
    };
  }

  private async replaceItems(executor: OrdersExecutor, orderId: string, items: NormalizedItem[]) {
    await executor.query('DELETE FROM order_items WHERE "orderId" = $1', [orderId]);
    if (items.length === 0) return;

    const params: unknown[] = [];
    const valueClauses: string[] = [];
    for (const [index, item] of items.entries()) {
      const b = params.length;
      params.push(
        item.lineId, orderId, item.productId, item.quantity,
        item.baseUnitPrice, item.unitPrice, item.lineDiscountAmount, item.lineSurchargeAmount,
        item.lineTotal, item.pricingTypeSnapshot, item.timeRateAmountSnapshot, item.timeRateMinutesSnapshot,
        item.usedMinutes, item.startAt, item.stopAt, index + 1, item.note || null,
      );
      valueClauses.push(
        `($${b+1}, $${b+2}, $${b+3}, $${b+4}, $${b+5}, $${b+6}, $${b+7}, $${b+8}, $${b+9}, $${b+10}, $${b+11}, $${b+12}, $${b+13}, $${b+14}::timestamptz, $${b+15}::timestamptz, $${b+16}, $${b+17}, NOW(), NOW())`,
      );
    }
    await executor.query(
      `INSERT INTO order_items (id, "orderId", "productId", quantity, "baseUnitPrice", "unitPrice", "lineDiscountAmount", "lineSurchargeAmount", "totalPrice", "pricingTypeSnapshot", "timeRateAmountSnapshot", "timeRateMinutesSnapshot", "usedMinutes", "startAt", "stopAt", "displayOrder", note, "createdAt", "updatedAt")
       VALUES ${valueClauses.join(', ')}`,
      params,
    );
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
    const branchId = this.branchPolicy.resolveReadBranchId(user, params.branchId);
    if (!branchId) return { items: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 } };
    const page = Math.max(1, Math.trunc(Number(params.page) || 1));
    const pageSize = Math.max(1, Math.min(100, Math.trunc(Number(params.pageSize) || 10)));
    const now = new Date();
    const isAfterNoon = now.getHours() >= 12;
    const defaultStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
    if (!isAfterNoon) defaultStartDate.setDate(defaultStartDate.getDate() - 1);
    const defaultEndDate = new Date(defaultStartDate);
    defaultEndDate.setDate(defaultEndDate.getDate() + 1);
    const defaultStart = `${defaultStartDate.getFullYear()}-${String(defaultStartDate.getMonth() + 1).padStart(2, '0')}-${String(defaultStartDate.getDate()).padStart(2, '0')}T12:00:00+07:00`;
    const defaultEnd = `${defaultEndDate.getFullYear()}-${String(defaultEndDate.getMonth() + 1).padStart(2, '0')}-${String(defaultEndDate.getDate()).padStart(2, '0')}T12:00:00+07:00`;
    const where: string[] = ['od."branchId" = $1'];
    const sqlParams: unknown[] = [branchId];
    const buildExclusiveEnd = (value: string) => {
      const end = new Date(String(value).trim());
      if (Number.isNaN(end.getTime())) throw new BadRequestException('Thời gian kết thúc không hợp lệ');
      end.setSeconds(0, 0);
      end.setMinutes(end.getMinutes() + 1);
      return end.toISOString();
    };
    if (params.search?.trim()) {
      sqlParams.push(`%${params.search.trim()}%`);
      where.push(`(
        od."orderCode" ILIKE $${sqlParams.length}
        OR COALESCE(od."customerName", '') ILIKE $${sqlParams.length}
        OR COALESCE(a.name, ar.name, '') ILIKE $${sqlParams.length}
        OR COALESCE(r.name, '') ILIKE $${sqlParams.length}
        OR COALESCE(t.name, '') ILIKE $${sqlParams.length}
        OR COALESCE(NULLIF(u."fullName", ''), u.username, '') ILIKE $${sqlParams.length}
      )`);
    }
    if (params.orderStates?.length) {
      sqlParams.push(params.orderStates);
      where.push(`od."orderState"::text = ANY($${sqlParams.length}::text[])`);
    }
    if (params.paymentMethod) {
      sqlParams.push(params.paymentMethod);
      where.push(`od."paymentMethod"::text = $${sqlParams.length}`);
    }
    if (params.areaId) {
      sqlParams.push(params.areaId);
      where.push(`(
        od."tableId" IN (SELECT id FROM tables WHERE "areaId" = $${sqlParams.length} AND "deletedAt" IS NULL)
        OR od."roomId" IN (SELECT id FROM rooms WHERE "areaId" = $${sqlParams.length} AND "deletedAt" IS NULL)
      )`);
    }
    if (params.roomId) {
      sqlParams.push(params.roomId);
      where.push(`od."roomId" = $${sqlParams.length}`);
    }
    if (params.tableId) {
      sqlParams.push(params.tableId);
      where.push(`od."tableId" = $${sqlParams.length}`);
    }
    const effectiveStartDate = params.startDate?.trim() || defaultStart;
    const effectiveEndDate = params.endDate?.trim() || defaultEnd;
    sqlParams.push(effectiveStartDate);
    where.push(`od."createdAt" >= $${sqlParams.length}::timestamptz`);
    sqlParams.push(buildExclusiveEnd(effectiveEndDate));
    where.push(`od."createdAt" < $${sqlParams.length}::timestamptz`);
    const whereSql = where.join(' AND ');
    const totalRows = await this.db.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM orders od
       LEFT JOIN users u ON u.id = od."userId"
       LEFT JOIN tables t ON t.id = od."tableId"
       LEFT JOIN rooms r ON r.id = od."roomId"
       LEFT JOIN areas a ON a.id = t."areaId"
       LEFT JOIN areas ar ON ar.id = r."areaId"
       WHERE ${whereSql}`,
      sqlParams,
    );
    const total = Number(totalRows[0]?.total || 0);
    sqlParams.push(pageSize, (page - 1) * pageSize);
    const rows = await this.db.query<{
      id: string; code: string; tableName: string | null; customerName: string | null; creatorName: string | null;
      totalAmount: string; finalAmount: string; paidAmount: string; isDebtMarked: boolean; paymentMethod: PaymentMethod | null; orderState: 'DRAFT' | 'PAYING' | 'PAID' | 'PARTIAL' | 'UNPAID' | 'DELETED'; createdAt: string; leftTime: string | null;
    }>(
      `SELECT od.id, od."orderCode" AS code,
              COALESCE(NULLIF(CONCAT_WS(' / ', COALESCE(a.name, ar.name), r.name, t.name), ''), '-') AS "tableName",
              od."customerName" AS "customerName",
              COALESCE(NULLIF(u."fullName", ''), u.username, '-') AS "creatorName",
              od."totalAmount"::text AS "totalAmount", od."finalAmount"::text AS "finalAmount", od."paidAmount"::text AS "paidAmount", od."isDebtMarked" AS "isDebtMarked",
              od."paymentMethod"::text AS "paymentMethod", od."orderState" AS "orderState", od."createdAt" AS "createdAt", od."leftTime" AS "leftTime"
       FROM orders od
       LEFT JOIN users u ON u.id = od."userId"
       LEFT JOIN tables t ON t.id = od."tableId"
       LEFT JOIN rooms r ON r.id = od."roomId"
       LEFT JOIN areas a ON a.id = t."areaId"
       LEFT JOIN areas ar ON ar.id = r."areaId"
       WHERE ${whereSql}
       ORDER BY CASE od."orderState"::text
          WHEN 'PAYING' THEN 1
          WHEN 'UNPAID' THEN 2
          WHEN 'PARTIAL' THEN 3
          WHEN 'PAID' THEN 4
          WHEN 'DRAFT' THEN 5
          WHEN 'DELETED' THEN 99
          ELSE 98
        END ASC,
        od."createdAt" DESC
       LIMIT $${sqlParams.length - 1} OFFSET $${sqlParams.length}`,
      sqlParams,
    );
    return {
      items: rows.map((r) => ({ ...r, totalAmount: this.toMoney(r.totalAmount), finalAmount: this.toMoney(r.finalAmount), paidAmount: this.toMoney(r.paidAmount) })),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async getActiveLocationCounts(user: CurrentUser, requestedBranchId?: string) {
    const branchId = this.branchPolicy.resolveReadBranchId(user, requestedBranchId);
    const params: unknown[] = [];
    let whereSql = 'WHERE od."orderState" IN ($1::"OrderLifecycleState", $2::"OrderLifecycleState")';
    params.push('PAYING', 'UNPAID');
    if (branchId) {
      params.push(branchId);
      whereSql += ` AND od."branchId" = $${params.length}`;
    }
    const rows = await this.db.query<{
      tableId: string | null;
      roomId: string | null;
      payingCount: string;
      unpaidCount: string;
    }>(
      `SELECT od."tableId" AS "tableId",
              od."roomId" AS "roomId",
              SUM(CASE WHEN od."orderState" = 'PAYING'::"OrderLifecycleState" THEN 1 ELSE 0 END)::text AS "payingCount",
              SUM(CASE WHEN od."orderState" = 'UNPAID'::"OrderLifecycleState" THEN 1 ELSE 0 END)::text AS "unpaidCount"
       FROM orders od
       ${whereSql}
       GROUP BY od."tableId", od."roomId"`,
      params,
    );

    const tableCounts: Array<{ tableId: string; payingCount: number; unpaidCount: number }> = [];
    const roomCounts: Array<{ roomId: string; payingCount: number; unpaidCount: number }> = [];

    rows.forEach((row) => {
      const payingCount = Math.max(0, Math.trunc(Number(row.payingCount || 0)));
      const unpaidCount = Math.max(0, Math.trunc(Number(row.unpaidCount || 0)));
      if (row.tableId) tableCounts.push({ tableId: row.tableId, payingCount, unpaidCount });
      if (row.roomId) roomCounts.push({ roomId: row.roomId, payingCount, unpaidCount });
    });

    return { tableCounts, roomCounts };
  }

  async createOrder(user: CurrentUser, input: CreateOrderInput) {
    if (input.entityType && input.entityType !== 'TABLE' && input.entityType !== 'ROOM') throw new BadRequestException('Loại đối tượng hóa đơn không hợp lệ');
    const orderId = randomUUID();
    const branchId = await this.resolveResourceBranch(user, input);
    let normalizedInput: CreateOrderInput = input;
    if (!input.entityType || (input.entityType === 'TABLE' && !input.tableId) || (input.entityType === 'ROOM' && !input.roomId)) {
      const takeawayTableId = await this.resolveTakeawayTableId(branchId);
      normalizedInput = {
        ...input,
        entityType: 'TABLE',
        tableId: takeawayTableId,
        roomId: undefined,
      };
    }
    const items = await this.normalizeItems(orderId, input.billItems);
    const isDraftCreate = String(input.orderState || '').toUpperCase() === 'DRAFT';
    if (items.length === 0 && !isDraftCreate) throw new BadRequestException('Hóa đơn phải có ít nhất một món');
    if (isDraftCreate) {
      await this.cleanupEmptyDraftOrdersForUserBranch(user.id, branchId);
    }
    const totals = this.computeOrderTotals({
      itemsSubtotal: items.reduce((sum, it) => sum + it.lineTotal, 0),
      itemDiscountTotal: items.reduce((sum, it) => sum + it.lineDiscountAmount, 0),
      discountMode: input.discountMode,
      discountValue: input.discountValue,
      discountAmount: input.discountAmount,
      surchargeMode: input.surchargeMode,
      surchargeValue: input.surchargeValue,
      surchargeAmount: input.surchargeAmount,
      paidAmount: input.paidAmount,
      isDebtMarked: input.isDebtMarked,
      orderState: input.orderState,
      hasOpenTimeItems: items.some((it) => it.pricingTypeSnapshot === 'TIME' && it.stopAt == null),
      applyOpenTimeStateRule: !isDraftCreate,
    });
    const paymentMethod = this.normalizePaymentMethod(input.paymentMethod, 'CASH');
    let code = '';
    await this.db.withTransaction(async (tx) => {
      code = await this.generateOrderCode(tx);
      await tx.query(
        `INSERT INTO orders (id, "orderCode", "tableId", "roomId", "branchId", "userId", "totalAmount", "discountAmount", "discountMode", "discountValue", "surchargeAmount", "surchargeMode", "surchargeValue", "finalAmount", "paidAmount", "isDebtMarked", "paymentMethod", "orderState", "customerName", "leftTime", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::"OrderAdjustmentMode", $10, $11, $12::"OrderAdjustmentMode", $13, $14, $15, $16, $17::"PaymentMethod", $18::"OrderLifecycleState", $19,
           CASE WHEN $15::numeric > 0 OR $16::boolean = true THEN NOW() ELSE NULL END,
           NOW(), NOW())`,
        [
          orderId, code, normalizedInput.entityType === 'TABLE' ? normalizedInput.tableId || null : null, normalizedInput.entityType === 'ROOM' ? normalizedInput.roomId || null : null,
          branchId, user.id, totals.subtotalAmount, totals.discountAmount, totals.discountMode, totals.discountValue,
          totals.surchargeAmount, totals.surchargeMode, totals.surchargeValue, totals.finalAmount, totals.paidAmount, totals.isDebtMarked, paymentMethod, totals.orderState,
          input.customerName || null,
        ],
      );
      await this.replaceItems(tx, orderId, items);
      await this.logAction(tx, {
        orderId,
        action: 'CREATE_ORDER',
        detail: 'Tạo hóa đơn',
        userId: user.id,
        snapshot: {
          order: {
            entityType: normalizedInput.entityType,
            tableId: normalizedInput.entityType === 'TABLE' ? normalizedInput.tableId || null : null,
            roomId: normalizedInput.entityType === 'ROOM' ? normalizedInput.roomId || null : null,
            customerName: input.customerName || '',
            totalAmount: totals.subtotalAmount,
            discountMode: totals.discountMode,
            discountValue: totals.discountValue,
            discountAmount: totals.discountAmount,
            surchargeMode: totals.surchargeMode,
            surchargeValue: totals.surchargeValue,
            surchargeAmount: totals.surchargeAmount,
            finalAmount: totals.finalAmount,
            paidAmount: totals.paidAmount,
            isDebtMarked: totals.isDebtMarked,
            paymentMethod,
            orderState: totals.orderState,
          },
          items: items.map((it) => this.mapItemForSnapshot(it)),
        },
      });
    });
    return { id: orderId, code, itemMappings: items.map((i) => ({ clientLineId: i.clientLineId, orderItemId: i.lineId })) };
  }

  async getOrderById(user: CurrentUser, id: string) {
    const rows = await this.db.query<{
      id: string; code: string; tableId: string | null; roomId: string | null; tableName: string | null; roomName: string | null; areaName: string | null;
      customerName: string | null; discountAmount: string; discountMode: AdjustmentMode; discountValue: string; surchargeAmount: string; surchargeMode: AdjustmentMode; surchargeValue: string;
      totalAmount: string; finalAmount: string; paidAmount: string; isDebtMarked: boolean; paymentMethod: PaymentMethod | null; orderState: 'DRAFT' | 'PAYING' | 'PAID' | 'PARTIAL' | 'UNPAID' | 'DELETED'; branchId: string | null; createdAt: string; leftTime: string | null; updatedAt: string;
    }>(
      `SELECT od.id, od."orderCode" AS code, od."tableId" AS "tableId", od."roomId" AS "roomId", t.name AS "tableName", r.name AS "roomName", COALESCE(a.name, ar.name) AS "areaName",
              od."customerName" AS "customerName", od."discountAmount"::text AS "discountAmount", od."discountMode"::text AS "discountMode", od."discountValue"::text AS "discountValue",
              od."surchargeAmount"::text AS "surchargeAmount", od."surchargeMode"::text AS "surchargeMode", od."surchargeValue"::text AS "surchargeValue",
              od."totalAmount"::text AS "totalAmount", od."finalAmount"::text AS "finalAmount", od."paidAmount"::text AS "paidAmount", od."isDebtMarked" AS "isDebtMarked", od."paymentMethod"::text AS "paymentMethod",
              od."orderState" AS "orderState", od."branchId" AS "branchId", od."createdAt" AS "createdAt", od."leftTime" AS "leftTime", od."updatedAt" AS "updatedAt"
       FROM orders od
       LEFT JOIN tables t ON t.id = od."tableId"
       LEFT JOIN rooms r ON r.id = od."roomId"
       LEFT JOIN areas a ON a.id = t."areaId"
       LEFT JOIN areas ar ON ar.id = r."areaId"
       WHERE od.id = $1 LIMIT 1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Hóa đơn không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, rows[0].branchId);

    const itemRows = await this.db.query<{
      id: string; productId: string; productName: string; pricingTypeSnapshot: 'FIXED' | 'TIME'; quantity: number;
      baseUnitPrice: string; unitPrice: string; totalPrice: string; lineDiscountAmount: string; lineSurchargeAmount: string; timeRateAmountSnapshot: string | null; timeRateMinutesSnapshot: number | null; usedMinutes: number; startAt: string | null; stopAt: string | null; note: string | null; unit: string | null;
      comboItems: { itemProductId: string; quantity: number; itemName: string; itemUnit: string | null }[] | null;
    }>(
      `SELECT oi.id, oi."productId" AS "productId", p.name AS "productName", oi."pricingTypeSnapshot"::text AS "pricingTypeSnapshot", oi.quantity,
              oi."baseUnitPrice"::text AS "baseUnitPrice", oi."unitPrice"::text AS "unitPrice", oi."totalPrice"::text AS "totalPrice", oi."lineDiscountAmount"::text AS "lineDiscountAmount", oi."lineSurchargeAmount"::text AS "lineSurchargeAmount", oi."timeRateAmountSnapshot"::text AS "timeRateAmountSnapshot", oi."timeRateMinutesSnapshot" AS "timeRateMinutesSnapshot", oi."usedMinutes" AS "usedMinutes",
              oi."startAt"::text AS "startAt", oi."stopAt"::text AS "stopAt", oi.note, p.unit AS unit,
              COALESCE(combo_agg.items, '[]'::json) AS "comboItems"
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi."productId"
       LEFT JOIN LATERAL (
         SELECT JSON_AGG(
           JSON_BUILD_OBJECT(
             'itemProductId', pci."itemProductId",
             'quantity', pci.quantity,
             'itemName', pi.name,
             'itemUnit', pi.unit
           )
           ORDER BY pi.name
         ) AS items
         FROM product_combo_items pci
         INNER JOIN products pi ON pi.id = pci."itemProductId"
         WHERE pci."comboProductId" = oi."productId"
       ) combo_agg ON true
       WHERE oi."orderId" = $1
       ORDER BY oi."displayOrder" ASC, oi."createdAt" ASC`,
      [id],
    );
    const head = rows[0];
    return {
      id: head.id,
      code: head.code,
      entityType: head.tableId ? 'TABLE' : 'ROOM',
      tableId: head.tableId,
      roomId: head.roomId,
      areaName: head.areaName,
      roomName: head.roomName,
      tableName: head.tableName,
      locationLabel: [head.areaName || '', head.roomName || '', head.tableName || ''].filter(Boolean).join(' / '),
      customerName: head.customerName,
      discountAmount: this.toMoney(head.discountAmount),
      discountMode: this.normalizeAdjustmentMode(head.discountMode, 'amount'),
      discountValue: this.toRawAdjustmentValue(head.discountValue),
      surchargeAmount: this.toMoney(head.surchargeAmount),
      surchargeMode: this.normalizeAdjustmentMode(head.surchargeMode, 'amount'),
      surchargeValue: this.toRawAdjustmentValue(head.surchargeValue),
      totalAmount: this.toMoney(head.totalAmount),
      finalAmount: this.toMoney(head.finalAmount),
      paidAmount: this.toMoney(head.paidAmount),
      isDebtMarked: Boolean(head.isDebtMarked),
      paymentMethod: head.paymentMethod,
      orderState: head.orderState,
      createdAt: head.createdAt,
      leftTime: head.leftTime,
      updatedAt: head.updatedAt,
      items: itemRows.map((item) => ({
        lineId: item.id,
        orderItemId: item.id,
        productId: item.productId,
        productName: item.productName || '-',
        pricingTypeSnapshot: item.pricingTypeSnapshot,
        unit: item.unit || undefined,
        baseUnitPrice: this.toMoney(item.baseUnitPrice),
        unitPrice: this.toMoney(item.unitPrice),
        lineTotal: this.toMoney(item.totalPrice),
        quantity: Math.max(1, Math.trunc(Number(item.quantity) || 1)),
        timeRateAmountSnapshot: item.timeRateAmountSnapshot == null ? null : this.toMoney(item.timeRateAmountSnapshot),
        timeRateMinutesSnapshot: item.timeRateMinutesSnapshot,
        usedMinutes: Math.max(0, Math.trunc(Number(item.usedMinutes) || 0)),
        timerStatus: item.startAt && !item.stopAt ? 'RUNNING' : 'STOPPED',
        activeSessionStartedAt: item.startAt,
        startAt: item.startAt,
        stopAt: item.stopAt,
        lineDiscountAmount: this.toMoney(item.lineDiscountAmount),
        lineSurchargeAmount: this.toMoney(item.lineSurchargeAmount),
        note: item.note || '',
        comboItems: Array.isArray(item.comboItems) ? item.comboItems : typeof item.comboItems === 'string' ? JSON.parse(item.comboItems) : [],
      })),
    };
  }

  async updateOrder(user: CurrentUser, id: string, input: UpdateOrderInput) {
    const rows = await this.db.query<{ id: string; branchId: string | null; tableId: string | null; roomId: string | null; customerName: string | null; totalAmount: string; finalAmount: string; discountAmount: string; discountMode: AdjustmentMode; discountValue: string; surchargeAmount: string; surchargeMode: AdjustmentMode; surchargeValue: string; paidAmount: string; isDebtMarked: boolean; paymentMethod: PaymentMethod | null; orderState: 'DRAFT' | 'PAYING' | 'PAID' | 'PARTIAL' | 'UNPAID' | 'DELETED' }>(
      'SELECT id, "branchId" AS "branchId", "tableId" AS "tableId", "roomId" AS "roomId", "customerName" AS "customerName", "totalAmount"::text AS "totalAmount", "finalAmount"::text AS "finalAmount", "discountAmount"::text AS "discountAmount", "discountMode", "discountValue"::text AS "discountValue", "surchargeAmount"::text AS "surchargeAmount", "surchargeMode", "surchargeValue"::text AS "surchargeValue", "paidAmount"::text AS "paidAmount", "isDebtMarked" AS "isDebtMarked", "paymentMethod"::text AS "paymentMethod", "orderState" AS "orderState" FROM orders WHERE id = $1 LIMIT 1',
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Hóa đơn không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, rows[0].branchId);
    if (rows[0].orderState === 'DELETED') throw new BadRequestException('Không thể cập nhật hóa đơn đã xóa');
    const requestedOrderState = String(input.orderState || '').toUpperCase();
    const effectiveOrderState = requestedOrderState === 'DRAFT' && rows[0].orderState !== 'DRAFT'
      ? undefined
      : input.orderState;

    const currentItemsRows = await this.db.query<{
      id: string; productId: string; productName: string; unit: string | null; baseUnitPrice: string; unitPrice: string; quantity: number;
      pricingTypeSnapshot: 'FIXED' | 'TIME'; lineDiscountAmount: string; lineSurchargeAmount: string; timeRateAmountSnapshot: string | null; timeRateMinutesSnapshot: number | null; usedMinutes: number; startAt: string | null; stopAt: string | null; note: string | null;
    }>(
      `SELECT oi.id, oi."productId" AS "productId", p.name AS "productName", p.unit AS unit, oi."baseUnitPrice"::text AS "baseUnitPrice", oi."unitPrice"::text AS "unitPrice", oi.quantity,
              oi."pricingTypeSnapshot"::text AS "pricingTypeSnapshot", oi."lineDiscountAmount"::text AS "lineDiscountAmount", oi."lineSurchargeAmount"::text AS "lineSurchargeAmount", oi."timeRateAmountSnapshot"::text AS "timeRateAmountSnapshot", oi."timeRateMinutesSnapshot" AS "timeRateMinutesSnapshot", oi."usedMinutes" AS "usedMinutes", oi."startAt"::text AS "startAt", oi."stopAt"::text AS "stopAt", oi.note
       FROM order_items oi LEFT JOIN products p ON p.id = oi."productId" WHERE oi."orderId" = $1`,
      [id],
    );
    let nextBillItems: CreateOrderInput['billItems'] = currentItemsRows.map((r) => ({
      lineId: r.id,
      productId: r.productId,
      productName: r.productName || '-',
      unit: r.unit || undefined,
      baseUnitPrice: this.toMoney(r.baseUnitPrice),
      unitPrice: this.toMoney(r.unitPrice),
      quantity: Math.max(1, Math.trunc(Number(r.quantity) || 1)),
      note: r.note || '',
      pricingTypeSnapshot: r.pricingTypeSnapshot,
      timeRateAmountSnapshot: r.timeRateAmountSnapshot == null ? undefined : this.toMoney(r.timeRateAmountSnapshot),
      timeRateMinutesSnapshot: r.timeRateMinutesSnapshot || undefined,
      usedMinutes: Math.max(0, Math.trunc(Number(r.usedMinutes) || 0)),
      startAt: r.startAt,
      stopAt: r.stopAt,
      lineDiscountAmount: this.toMoney(r.lineDiscountAmount),
      lineSurchargeAmount: this.toMoney(r.lineSurchargeAmount),
    }));

    if (Array.isArray(input.billItems)) {
      const currentById = new Map(nextBillItems.map((it) => [it.lineId, it]));
      nextBillItems = input.billItems.map((item) => {
        const current = currentById.get(item.lineId);
        return {
          ...item,
          startAt: item.startAt ?? current?.startAt ?? null,
          stopAt: item.stopAt ?? current?.stopAt ?? null,
        };
      });
    } else if (input.billItemsPatch) {
      const byId = new Map(nextBillItems.map((it) => [it.lineId, it]));
      for (const idToRemove of input.billItemsPatch.removedItemIds || []) byId.delete(idToRemove);
      for (const patch of input.billItemsPatch.updatedItems || []) {
        const current = byId.get(patch.lineId);
        if (!current) throw new BadRequestException({ message: 'Không tìm thấy dòng món trong hóa đơn', reason: 'line_not_found' });
        byId.set(patch.lineId, {
          ...current,
          ...patch,
          startAt: patch.startAt ?? current.startAt ?? null,
          stopAt: patch.stopAt ?? current.stopAt ?? null,
          lineId: patch.lineId,
        });
      }
      for (const add of input.billItemsPatch.addedItems || []) {
        const newLineId = String(add.lineId || randomUUID());
        byId.set(newLineId, { ...add, lineId: newLineId });
      }
      nextBillItems = Array.from(byId.values());
    }

    const normalized = await this.normalizeItems(id, nextBillItems);
    const totals = this.computeOrderTotals({
      itemsSubtotal: normalized.reduce((sum, it) => sum + it.lineTotal, 0),
      itemDiscountTotal: normalized.reduce((sum, it) => sum + it.lineDiscountAmount, 0),
      discountMode: input.discountMode ?? rows[0].discountMode,
      discountValue: input.discountValue,
      discountAmount: input.discountAmount ?? rows[0].discountValue,
      surchargeMode: input.surchargeMode ?? rows[0].surchargeMode,
      surchargeValue: input.surchargeValue,
      surchargeAmount: input.surchargeAmount ?? rows[0].surchargeValue,
      paidAmount: input.paidAmount ?? rows[0].paidAmount,
      isDebtMarked: input.isDebtMarked ?? rows[0].isDebtMarked,
      orderState: effectiveOrderState,
      hasOpenTimeItems: normalized.some((it) => it.pricingTypeSnapshot === 'TIME' && it.stopAt == null),
      applyOpenTimeStateRule: String(effectiveOrderState || rows[0].orderState || '').toUpperCase() !== 'DRAFT',
    });
    const paymentMethod = this.normalizePaymentMethod(input.paymentMethod ?? rows[0].paymentMethod, 'CASH');
    const normalizedTableId = typeof input.tableId === 'string' ? input.tableId.trim() : input.tableId;
    const normalizedRoomId = typeof input.roomId === 'string' ? input.roomId.trim() : input.roomId;

    let nextTableId = rows[0].tableId;
    let nextRoomId = rows[0].roomId;

    if (input.entityType === 'TABLE') {
      if (normalizedTableId) {
        nextTableId = normalizedTableId;
        nextRoomId = null;
      } else {
        if (!rows[0].branchId) throw new BadRequestException('Hóa đơn chưa có chi nhánh để gán bàn mang về');
        nextTableId = await this.resolveTakeawayTableId(rows[0].branchId);
        nextRoomId = null;
      }
    } else if (input.entityType === 'ROOM') {
      if (normalizedRoomId) {
        nextTableId = null;
        nextRoomId = normalizedRoomId;
      } else {
        if (!rows[0].branchId) throw new BadRequestException('Hóa đơn chưa có chi nhánh để gán bàn mang về');
        nextTableId = await this.resolveTakeawayTableId(rows[0].branchId);
        nextRoomId = null;
      }
    }

    const previousOrderSnapshot = {
      tableId: rows[0].tableId,
      roomId: rows[0].roomId,
      customerName: rows[0].customerName || '',
      totalAmount: this.toMoney(rows[0].totalAmount),
      discountMode: rows[0].discountMode,
      discountValue: this.toRawAdjustmentValue(rows[0].discountValue),
      discountAmount: this.toMoney(rows[0].discountAmount),
      surchargeMode: rows[0].surchargeMode,
      surchargeValue: this.toRawAdjustmentValue(rows[0].surchargeValue),
      surchargeAmount: this.toMoney(rows[0].surchargeAmount),
      finalAmount: this.toMoney(rows[0].finalAmount),
      paidAmount: this.toMoney(rows[0].paidAmount),
      isDebtMarked: Boolean(rows[0].isDebtMarked),
      paymentMethod: this.normalizePaymentMethod(rows[0].paymentMethod, 'CASH'),
      orderState: rows[0].orderState,
    };
    const nextOrderSnapshot = {
      tableId: nextTableId,
      roomId: nextRoomId,
      customerName: input.customerName ?? rows[0].customerName ?? '',
      discountMode: totals.discountMode,
      discountValue: totals.discountValue,
      discountAmount: totals.discountAmount,
      surchargeMode: totals.surchargeMode,
      surchargeValue: totals.surchargeValue,
      surchargeAmount: totals.surchargeAmount,
      totalAmount: totals.subtotalAmount,
      finalAmount: totals.finalAmount,
      paidAmount: totals.paidAmount,
      isDebtMarked: totals.isDebtMarked,
      paymentMethod,
      orderState: totals.orderState,
    };

    const orderChanges: Record<string, { from: unknown; to: unknown }> = {};
    const orderChangeKeys: Array<keyof typeof nextOrderSnapshot> = [
      'tableId', 'roomId', 'customerName', 'discountMode', 'discountValue', 'discountAmount', 'surchargeMode', 'surchargeValue', 'surchargeAmount',
      'totalAmount', 'finalAmount', 'paidAmount', 'isDebtMarked', 'paymentMethod', 'orderState',
    ];
    for (const key of orderChangeKeys) {
      const prevValue = (previousOrderSnapshot as Record<string, unknown>)[key];
      const nextValue = (nextOrderSnapshot as Record<string, unknown>)[key];
      if (String(prevValue ?? '') !== String(nextValue ?? '')) {
        orderChanges[key] = { from: prevValue ?? null, to: nextValue ?? null };
      }
    }

    const previousItems = currentItemsRows.map((r) => this.mapItemForSnapshot({
      lineId: r.id,
      productId: r.productId,
      productName: r.productName || '-',
      pricingTypeSnapshot: r.pricingTypeSnapshot,
      quantity: Math.max(1, Math.trunc(Number(r.quantity) || 1)),
      baseUnitPrice: this.toMoney(r.baseUnitPrice),
      unitPrice: this.toMoney(r.unitPrice),
      lineTotal: r.pricingTypeSnapshot === 'TIME'
        ? this.calculateTimePrice(this.toMoney(r.unitPrice), Math.max(1, Math.trunc(Number(r.timeRateMinutesSnapshot) || 1)), Math.max(0, Math.trunc(Number(r.usedMinutes) || 0)))
        : Math.max(0, Math.trunc(Number(r.quantity) || 0)) * this.toMoney(r.unitPrice),
      lineDiscountAmount: this.toMoney(r.lineDiscountAmount),
      lineSurchargeAmount: this.toMoney(r.lineSurchargeAmount),
      usedMinutes: Math.max(0, Math.trunc(Number(r.usedMinutes) || 0)),
      startAt: r.startAt || null,
      stopAt: r.stopAt || null,
      note: r.note || '',
    }));
    const nextItems = normalized.map((it) => this.mapItemForSnapshot(it));
    const previousById = new Map(previousItems.map((it) => [it.lineId, it]));
    const nextById = new Map(nextItems.map((it) => [it.lineId, it]));
    const addedItems = nextItems.filter((it) => !previousById.has(it.lineId));
    const removedItems = previousItems.filter((it) => !nextById.has(it.lineId));
    const updatedItems = nextItems
      .filter((it) => previousById.has(it.lineId))
      .map((it) => {
        const prev = previousById.get(it.lineId)!;
        const fields: Record<string, { from: unknown; to: unknown }> = {};
        const keys: Array<keyof ItemLogSnapshot> = [
          'productId', 'productName', 'pricingTypeSnapshot', 'quantity', 'baseUnitPrice', 'unitPrice', 'lineTotal',
          'lineDiscountAmount', 'lineSurchargeAmount', 'usedMinutes', 'startAt', 'stopAt', 'note',
        ];
        for (const key of keys) {
          if (String(prev[key] ?? '') !== String(it[key] ?? '')) {
            fields[key] = { from: prev[key] ?? null, to: it[key] ?? null };
          }
        }
        return { lineId: it.lineId, productName: it.productName, fields };
      })
      .filter((it) => Object.keys(it.fields).length > 0);

    const changesSnapshot = {
      order: orderChanges,
      items: {
        added: addedItems,
        removed: removedItems,
        updated: updatedItems,
      },
    };

    await this.db.withTransaction(async (tx) => {
      await tx.query(
        `UPDATE orders SET "tableId" = $2, "roomId" = $3, "customerName" = $4, "discountMode" = $5::"OrderAdjustmentMode", "discountValue" = $6,
                           "discountAmount" = $7, "surchargeMode" = $8::"OrderAdjustmentMode", "surchargeValue" = $9, "surchargeAmount" = $10,
                           "totalAmount" = $11, "finalAmount" = $12, "paidAmount" = $13, "isDebtMarked" = $14, "paymentMethod" = $15::"PaymentMethod", "orderState" = $16::"OrderLifecycleState",
                           "leftTime" = COALESCE("leftTime", CASE WHEN $13::numeric > 0 OR $14::boolean = true THEN NOW() ELSE NULL END),
                           "updatedAt" = NOW()
         WHERE id = $1`,
        [
          id,
          nextTableId,
          nextRoomId,
          input.customerName ?? rows[0].customerName,
          totals.discountMode,
          totals.discountValue,
          totals.discountAmount,
          totals.surchargeMode,
          totals.surchargeValue,
          totals.surchargeAmount,
          totals.subtotalAmount,
          totals.finalAmount,
          totals.paidAmount,
          totals.isDebtMarked,
          paymentMethod,
          totals.orderState,
        ],
      );
      await this.replaceItems(tx, id, normalized);
      const hasChanges = Object.keys(orderChanges).length > 0 || addedItems.length > 0 || removedItems.length > 0 || updatedItems.length > 0;
      if (hasChanges) {
        await this.logAction(tx, { orderId: id, action: 'UPDATE_ORDER', detail: 'Cập nhật hóa đơn', userId: user.id, snapshot: changesSnapshot });
      }
    });
    return { success: true };
  }

  async markDeleted(user: CurrentUser, id: string) {
    const rows = await this.db.query<{ id: string; branchId: string | null; orderState: 'DRAFT' | 'PAYING' | 'PAID' | 'PARTIAL' | 'UNPAID' | 'DELETED' }>('SELECT id, "branchId" AS "branchId", "orderState" AS "orderState" FROM orders WHERE id = $1 LIMIT 1', [id]);
    if (!rows[0]) throw new NotFoundException('Hóa đơn không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, rows[0].branchId);

    if (rows[0].orderState === 'DELETED') return { success: true };
    await this.db.withTransaction(async (tx) => {
      await tx.query('DELETE FROM order_items WHERE "orderId" = $1', [id]);
      await tx.query('UPDATE orders SET "orderState" = $2::"OrderLifecycleState", "updatedAt" = NOW() WHERE id = $1', [id, 'DELETED']);
      await this.logAction(tx, { orderId: id, action: 'DELETE_ORDER', detail: 'Xóa hóa đơn', userId: user.id });
    });
    return { success: true };
  }

  async hardDelete(user: CurrentUser, id: string) {
    const rows = await this.db.query<{ id: string; branchId: string | null }>('SELECT id, "branchId" AS "branchId" FROM orders WHERE id = $1 LIMIT 1', [id]);
    if (!rows[0]) throw new NotFoundException('Hóa đơn không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, rows[0].branchId);
    await this.db.query('DELETE FROM orders WHERE id = $1', [id]);
    return { success: true };
  }
  async printOrder(user: CurrentUser, id: string, payload?: { success?: boolean; printType?: 'INVOICE' | 'ORDER_SLIP'; message?: string }) {
    const rows = await this.db.query<{ id: string; branchId: string | null; orderState: 'DRAFT' | 'PAYING' | 'PAID' | 'PARTIAL' | 'UNPAID' | 'DELETED' }>(
      'SELECT id, "branchId" AS "branchId", "orderState" AS "orderState" FROM orders WHERE id = $1 LIMIT 1',
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Hóa đơn không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, rows[0].branchId);
    const printType = payload?.printType === 'ORDER_SLIP' ? 'Phiếu order' : 'Hóa đơn';
    const isSuccess = payload?.success !== false;
    const detail = `${isSuccess ? 'In thành công' : 'In thất bại'} ${printType}${payload?.message ? `: ${String(payload.message).slice(0, 500)}` : ''}`;
    await this.db.withTransaction(async (tx) => {
      await this.logAction(tx, {
        orderId: id,
        action: 'PRINT_ORDER',
        detail,
        userId: user.id,
        snapshot: {
          printType: payload?.printType === 'ORDER_SLIP' ? 'ORDER_SLIP' : 'INVOICE',
          success: isSuccess,
        },
      });
      if (isSuccess && payload?.printType === 'INVOICE' && (rows[0].orderState === 'DRAFT' || rows[0].orderState === 'UNPAID' || rows[0].orderState === 'PARTIAL')) {
        await tx.query('UPDATE orders SET "orderState" = $2::"OrderLifecycleState", "updatedAt" = NOW() WHERE id = $1', [id, 'PAYING']);
      }
    });
    return { success: true };
  }

  async getOrderLogs(user: CurrentUser, id: string) {
    const rows = await this.db.query<{ id: string; branchId: string | null }>('SELECT id, "branchId" AS "branchId" FROM orders WHERE id = $1 LIMIT 1', [id]);
    if (!rows[0]) throw new NotFoundException('Hóa đơn không tồn tại');
    this.branchPolicy.assertResourceBranchAccess(user, rows[0].branchId);
    return this.db.query<{
      id: string; action: string; detail: string | null; snapshot: unknown; createdBy: string | null; createdByName: string | null; createdAt: string;
    }>(
      `SELECT l.id, l.action, l.detail, l.snapshot, l."createdBy" AS "createdBy", COALESCE(NULLIF(u."fullName", ''), u.username, l."createdBy") AS "createdByName", l."createdAt" AS "createdAt"
       FROM order_logs l LEFT JOIN users u ON u.id = l."createdBy" WHERE l."orderId" = $1 ORDER BY l."createdAt" DESC`,
      [id],
    );
  }
}
