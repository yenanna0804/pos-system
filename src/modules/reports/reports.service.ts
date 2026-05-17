import { BadRequestException, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import type { CurrentUser } from '../../common/auth.types';
import { BranchPolicyService } from '../../common/branch-policy.service';
import { PgService } from '../../database/pg.service';

type ReportQuery = {
  branchId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  orderStates?: string[];
  areaId?: string;
  roomId?: string;
  tableId?: string;
  paymentMethod?: 'CASH' | 'BANKING';
};

type ReportRow = {
  id: string;
  code: string;
  createdAt: string;
  receiverName: string | null;
  paymentMethod: 'CASH' | 'BANKING' | null;
  paidAmount: string;
  finalAmount: string;
  totalAmount: string;
  orderDiscountAmount: string;
  orderSurchargeAmount: string;
  itemDiscountAmount: string;
  itemSurchargeAmount: string;
  totalQuantity: string;
  locationLabel: string;
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly db: PgService,
    private readonly branchPolicy: BranchPolicyService,
  ) {}

  private toMoney(value: unknown) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return 0;
    return Math.round(num * 100) / 100;
  }

  private buildRange(startDate?: string, endDate?: string) {
    const now = new Date();
    const isAfterNoon = now.getHours() >= 12;
    const defaultStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
    if (!isAfterNoon) defaultStartDate.setDate(defaultStartDate.getDate() - 1);
    const defaultEndDate = new Date(defaultStartDate);
    defaultEndDate.setDate(defaultEndDate.getDate() + 1);
    const defaultStart = `${defaultStartDate.getFullYear()}-${String(defaultStartDate.getMonth() + 1).padStart(2, '0')}-${String(defaultStartDate.getDate()).padStart(2, '0')}T12:00:00+07:00`;
    const defaultEnd = `${defaultEndDate.getFullYear()}-${String(defaultEndDate.getMonth() + 1).padStart(2, '0')}-${String(defaultEndDate.getDate()).padStart(2, '0')}T12:00:00+07:00`;
    const from = startDate?.trim() || defaultStart;
    const to = endDate?.trim() || defaultEnd;
    const toDate = new Date(to);
    if (Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('Thời gian kết thúc không hợp lệ');
    }
    toDate.setSeconds(0, 0);
    toDate.setMinutes(toDate.getMinutes() + 1);
    return { from, toExclusive: toDate.toISOString() };
  }

  async getSalesEndOfDayReport(user: CurrentUser, query: ReportQuery) {
    const branchId = this.branchPolicy.resolveReadBranchId(user, query.branchId);
    if (!branchId) {
      return { groups: [], creators: [] };
    }

    const range = this.buildRange(query.startDate, query.endDate);
    const allowedStates = ['PAID', 'PARTIAL', 'UNPAID'];
    const requestedStates = (query.orderStates || []).filter((state) => allowedStates.includes(state));
    const effectiveStates = requestedStates.length ? requestedStates : allowedStates;

    const where: string[] = ['od."branchId" = $1', `od."orderState"::text = ANY($2::text[])`];
    const params: unknown[] = [branchId, effectiveStates];

    params.push(range.from);
    where.push(`od."createdAt" >= $${params.length}::timestamptz`);
    params.push(range.toExclusive);
    where.push(`od."createdAt" < $${params.length}::timestamptz`);

    if (query.search?.trim()) {
      params.push(`%${query.search.trim()}%`);
      where.push(`(
        od."orderCode" ILIKE $${params.length}
        OR COALESCE(od."customerName", '') ILIKE $${params.length}
        OR COALESCE(t.name, '') ILIKE $${params.length}
        OR COALESCE(r.name, '') ILIKE $${params.length}
        OR COALESCE(NULLIF(u."fullName", ''), u.username, '') ILIKE $${params.length}
      )`);
    }
    if (query.areaId) {
      params.push(query.areaId);
      where.push(`(
        od."tableId" IN (SELECT id FROM tables WHERE "areaId" = $${params.length} AND "deletedAt" IS NULL)
        OR od."roomId" IN (SELECT id FROM rooms WHERE "areaId" = $${params.length} AND "deletedAt" IS NULL)
      )`);
    }
    if (query.roomId) {
      params.push(query.roomId);
      where.push(`od."roomId" = $${params.length}`);
    }
    if (query.tableId) {
      params.push(query.tableId);
      where.push(`od."tableId" = $${params.length}`);
    }
    if (query.paymentMethod) {
      params.push(query.paymentMethod);
      where.push(`od."paymentMethod"::text = $${params.length}`);
    }

    const whereSql = where.join(' AND ');
    const rows = await this.db.query<ReportRow & QueryResultRow>(
      `SELECT
         od.id,
         od."orderCode" AS code,
         od."createdAt" AS "createdAt",
         COALESCE(NULLIF(u."fullName", ''), u.username, '-') AS "receiverName",
         od."paymentMethod"::text AS "paymentMethod",
         od."paidAmount"::text AS "paidAmount",
         od."finalAmount"::text AS "finalAmount",
         od."totalAmount"::text AS "totalAmount",
         od."discountAmount"::text AS "orderDiscountAmount",
         od."surchargeAmount"::text AS "orderSurchargeAmount",
         COALESCE(SUM(oi."lineDiscountAmount"), 0)::text AS "itemDiscountAmount",
         COALESCE(SUM(oi."lineSurchargeAmount"), 0)::text AS "itemSurchargeAmount",
         COALESCE(SUM(oi.quantity), 0)::text AS "totalQuantity",
         COALESCE(t.name, r.name, '-') AS "locationLabel"
       FROM orders od
       LEFT JOIN users u ON u.id = od."userId"
       LEFT JOIN tables t ON t.id = od."tableId"
       LEFT JOIN rooms r ON r.id = od."roomId"
       LEFT JOIN order_items oi ON oi."orderId" = od.id
       WHERE ${whereSql}
       GROUP BY od.id, u."fullName", u.username, t.name, r.name
       ORDER BY od."createdAt" DESC, od."orderCode" DESC`,
      params,
    );

    const creators = await this.db.query<{ id: string; name: string }>(
      `SELECT DISTINCT u.id, COALESCE(NULLIF(u."fullName", ''), u.username, '-') AS name
       FROM orders od
       LEFT JOIN users u ON u.id = od."userId"
       WHERE od."branchId" = $1
         AND od."orderState"::text = ANY($2::text[])
         AND u.id IS NOT NULL
       ORDER BY name ASC`,
      [branchId, allowedStates],
    );

    const groupMap = new Map<string, {
      date: string;
      summary: {
        orderCount: number;
        paymentAmount: number;
        debtAmount: number;
        revenueAmount: number;
        grossAmount: number;
        discountAmount: number;
        totalQuantity: number;
        serviceAmount: number;
      };
      rows: Array<Record<string, unknown>>;
    }>();

    for (const row of rows) {
      const dt = new Date(row.createdAt);
      const dayKey = Number.isNaN(dt.getTime())
        ? String(row.createdAt).slice(0, 10)
        : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

      const paidAmount = this.toMoney(row.paidAmount);
      const finalAmount = this.toMoney(row.finalAmount);
      const totalAmount = this.toMoney(row.totalAmount);
      const itemDiscountAmount = this.toMoney(row.itemDiscountAmount);
      const itemSurchargeAmount = this.toMoney(row.itemSurchargeAmount);
      // grossAmount = SUM(qty × baseUnitPrice) — giá gốc trước mọi điều chỉnh
      // = od.totalAmount (SUM lineTotal tại unitPrice) + lineDiscount - lineSurcharge
      const grossAmount = totalAmount + itemDiscountAmount - itemSurchargeAmount;
      const discountAmount = this.toMoney(row.orderDiscountAmount);
      const serviceAmount = this.toMoney(row.orderSurchargeAmount) + itemSurchargeAmount;
      const debtAmount = Math.max(0, finalAmount - paidAmount);
      const qty = this.toMoney(row.totalQuantity);

      if (!groupMap.has(dayKey)) {
        groupMap.set(dayKey, {
          date: dayKey,
          summary: {
            orderCount: 0,
            paymentAmount: 0,
            debtAmount: 0,
            revenueAmount: 0,
            grossAmount: 0,
            discountAmount: 0,
            totalQuantity: 0,
            serviceAmount: 0,
          },
          rows: [],
        });
      }

      const group = groupMap.get(dayKey)!;
      group.summary.orderCount += 1;
      group.summary.paymentAmount += paidAmount;
      group.summary.debtAmount += debtAmount;
      group.summary.revenueAmount += finalAmount;
      group.summary.grossAmount += grossAmount;
      group.summary.discountAmount += discountAmount;
      group.summary.totalQuantity += qty;
      group.summary.serviceAmount += serviceAmount;
      group.rows.push({
        id: row.id,
        code: row.code,
        createdAt: row.createdAt,
        receiverName: row.receiverName,
        paymentAmount: paidAmount,
        debtAmount,
        revenueAmount: finalAmount,
        grossAmount,
        discountAmount,
        totalQuantity: qty,
        serviceAmount,
        locationLabel: row.locationLabel,
        paymentMethod: row.paymentMethod,
      });
    }

    const groups = Array.from(groupMap.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
    return {
      groups,
      creators,
    };
  }

  async getProductReport(
    user: CurrentUser,
    query: ReportQuery & {
      categoryId?: string;
      search?: string;
      type?: 'SINGLE' | 'COMBO' | 'TIME';
      stockStatus?: 'all' | 'in_stock' | 'out_of_stock';
    },
  ) {
    const branchId = this.branchPolicy.resolveReadBranchId(user, query.branchId);
    if (!branchId) return { rows: [] };

    const range = this.buildRange(query.startDate, query.endDate);
    const effectiveStates = ['PAID', 'PARTIAL', 'UNPAID'];

    const where: string[] = [
      'od."branchId" = $1',
      `od."orderState"::text = ANY($2::text[])`,
      `od."createdAt" >= $3::timestamptz`,
      `od."createdAt" < $4::timestamptz`,
    ];
    const params: unknown[] = [branchId, effectiveStates, range.from, range.toExclusive];

    if (query.categoryId) {
      params.push(query.categoryId);
      where.push(`p."categoryId" = $${params.length}`);
    }
    if (query.search?.trim()) {
      params.push(`%${query.search.trim()}%`);
      where.push(`(COALESCE(p.name, '') ILIKE $${params.length} OR COALESCE(c.name, '') ILIKE $${params.length} OR COALESCE(p.sku, '') ILIKE $${params.length})`);
    }
    if (query.type === 'SINGLE' || query.type === 'COMBO' || query.type === 'TIME') {
      params.push(query.type);
      where.push(`p."type"::text = $${params.length}`);
    }
    if (query.stockStatus === 'in_stock') {
      where.push('COALESCE(p.stock, 0) > 0');
    } else if (query.stockStatus === 'out_of_stock') {
      where.push('COALESCE(p.stock, 0) <= 0');
    }

    const whereSql = where.join(' AND ');

    const rows = await this.db.query<{
      productId: string;
      productName: string;
      unit: string | null;
      categoryId: string | null;
      categoryName: string | null;
      costPrice: string | null;
      totalQuantity: string;
      grossAmount: string;
      discountAmount: string;
      surchargeAmount: string;
      netAmount: string;
      orderDetails: Array<{
        orderId: string;
        orderCode: string;
        createdAt: string;
        quantity: number;
        unitPrice: string;
        lineTotal: string;
      }>;
    }>(
      `SELECT
         oi."productId",
         COALESCE(p.name, '(Sản phẩm đã xóa)') AS "productName",
         p.unit,
         c.id AS "categoryId",
         c.name AS "categoryName",
         p."costPrice"::text AS "costPrice",
         SUM(oi.quantity)::text AS "totalQuantity",
         (SUM(oi."totalPrice") + SUM(oi."lineDiscountAmount") - SUM(oi."lineSurchargeAmount"))::text AS "grossAmount",
         SUM(oi."lineDiscountAmount")::text AS "discountAmount",
         SUM(oi."lineSurchargeAmount")::text AS "surchargeAmount",
         SUM(oi."totalPrice")::text AS "netAmount",
         json_agg(json_build_object(
           'orderId', od.id,
           'orderCode', od."orderCode",
           'createdAt', od."createdAt",
           'quantity', oi.quantity,
           'unitPrice', oi."unitPrice"::text,
           'lineTotal', oi."totalPrice"::text
         ) ORDER BY od."createdAt" DESC) AS "orderDetails"
       FROM order_items oi
       JOIN orders od ON od.id = oi."orderId"
       LEFT JOIN products p ON p.id = oi."productId"
       LEFT JOIN categories c ON c.id = p."categoryId" AND c."deletedAt" IS NULL
       WHERE ${whereSql}
       GROUP BY oi."productId", p.name, p.unit, c.id, c.name, p."costPrice"
       ORDER BY SUM(oi."totalPrice") DESC`,
      params,
    );

    return {
      rows: rows.map((r) => {
        const costPrice = r.costPrice != null ? this.toMoney(r.costPrice) : null;
        const totalQuantity = this.toMoney(r.totalQuantity);
        const netAmount = this.toMoney(r.netAmount);
        const grossProfit = costPrice != null ? Math.round((netAmount - costPrice * totalQuantity) * 100) / 100 : null;
        return {
          productId: r.productId,
          productName: r.productName || '-',
          unit: r.unit || null,
          categoryId: r.categoryId || null,
          categoryName: r.categoryName || 'Chưa phân loại',
          costPrice,
          totalQuantity,
          grossAmount: this.toMoney(r.grossAmount),
          discountAmount: this.toMoney(r.discountAmount),
          surchargeAmount: this.toMoney(r.surchargeAmount),
          netAmount,
          grossProfit,
          orderDetails: (r.orderDetails || []).map((o) => ({
            orderId: o.orderId,
            orderCode: o.orderCode,
            createdAt: o.createdAt,
            quantity: this.toMoney(o.quantity),
            unitPrice: this.toMoney(o.unitPrice),
            lineTotal: this.toMoney(o.lineTotal),
          })),
        };
      }),
    };
  }
}
