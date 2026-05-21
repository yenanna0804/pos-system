import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { PgService } from '../../database/pg.service';
import { BranchPolicyService } from '../../common/branch-policy.service';
import type { CurrentUser } from '../../common/auth.types';
import { VIETNAMESE_DIACRITICS_FROM, VIETNAMESE_DIACRITICS_TO } from '../../common/utils';

type CreateProductInput = {
  type?: 'SINGLE' | 'COMBO' | 'TIME';
  autoPrice?: boolean;
  sku?: string;
  name: string;
  categoryId?: string | null;
  unit?: string;
  weight?: number;
  costPrice?: number;
  price: number;
  timeRateAmount?: number;
  timeRateMinutes?: number;
  isActive?: boolean;
  branchConfigs?: { branchId: string; isActive: boolean; stock?: number }[];
  comboItems?: { itemProductId: string; quantity: number; itemName?: string; itemUnit?: string }[];
  imageUrl?: string | null;
  imageThumb?: string | null;
};

type ListProductsParams = {
  page: number;
  pageSize: number;
  type?: 'SINGLE' | 'COMBO' | 'TIME';
  types?: Array<'SINGLE' | 'COMBO' | 'TIME'>;
  categoryId?: string;
  stockStatus?: 'all' | 'in_stock' | 'out_of_stock';
  branchId?: string;
  search?: string;
};

type BranchConfigInput = { branchId: string; isActive: boolean; stock?: number };
type ComboItemInput = { itemProductId: string; quantity: number };
const SKU_REGEX = /^[A-Za-z0-9_-]{3,50}$/;
const UNIT_REGEX = /^[\p{L}\p{N}\s./-]{1,30}$/u;
const CATEGORY_NAME_REGEX = /^[\p{L}\p{N}\s&()./-]{2,100}$/u;

type UpdateCategoryInput = {
  name: string;
};

type ProductDeleteImpactOrder = {
  orderId: string;
  orderCode: string;
  orderState: 'DRAFT' | 'PARTIAL' | 'PAID' | 'UNPAID' | 'DELETED';
  createdAt: string;
  itemCount: number;
};

@Injectable()
export class ProductsService {
  constructor(
    private db: PgService,
    private readonly branchPolicy: BranchPolicyService,
  ) {}

  private toMoney(value: unknown) {
    return Math.max(0, Math.trunc(Number(value) || 0));
  }

  async processAndSaveImage(file: Express.Multer.File) {
    const acceptedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!acceptedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Ảnh phải là định dạng JPG, PNG hoặc WEBP');
    }

    const targetBytes = 250 * 1024;

    if (file.buffer.length <= targetBytes) {
      const thumb = await sharp(file.buffer)
        .resize(120, 120, { fit: 'cover' })
        .webp({ quality: 78 })
        .toBuffer();

      return {
        imageUrl: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
        imageThumb: `data:image/webp;base64,${thumb.toString('base64')}`,
        sizeKb: Number((file.buffer.length / 1024).toFixed(1)),
      };
    }

    const metadata = await sharp(file.buffer, { failOn: 'none' }).metadata();

    let width = metadata.width ?? 1600;
    let height = metadata.height ?? 1600;

    let best: Buffer | null = null;

    for (let pass = 0; pass < 8; pass++) {
      for (let quality = 92; quality >= 60; quality -= 4) {
        const candidate = await sharp(file.buffer, { failOn: 'none' })
          .resize(width, height, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality })
          .toBuffer();

        best = candidate;
        if (candidate.length <= targetBytes) {
          const thumb = await sharp(candidate)
            .resize(120, 120, { fit: 'cover' })
            .webp({ quality: 78 })
            .toBuffer();

          const base64 = candidate.toString('base64');
          const thumbBase64 = thumb.toString('base64');
          return {
            imageUrl: `data:image/webp;base64,${base64}`,
            imageThumb: `data:image/webp;base64,${thumbBase64}`,
            sizeKb: Number((candidate.length / 1024).toFixed(1)),
          };
        }
      }

      width = Math.max(320, Math.floor(width * 0.85));
      height = Math.max(320, Math.floor(height * 0.85));
    }

    if (!best) {
      throw new BadRequestException('Không thể xử lý ảnh');
    }

    if (best.length > targetBytes) {
      throw new BadRequestException('Không thể nén ảnh xuống dưới 250KB. Vui lòng chọn ảnh nhỏ hơn.');
    }

    const thumb = await sharp(best)
      .resize(120, 120, { fit: 'cover' })
      .webp({ quality: 78 })
      .toBuffer();

    const base64 = best.toString('base64');
    const thumbBase64 = thumb.toString('base64');
    return {
      imageUrl: `data:image/webp;base64,${base64}`,
      imageThumb: `data:image/webp;base64,${thumbBase64}`,
      sizeKb: Number((best.length / 1024).toFixed(1)),
    };
  }

  async listProducts(params: ListProductsParams, user: CurrentUser) {
    const scopedBranchId = this.branchPolicy.resolveReadBranchId(user, params.branchId);
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const whereParts: string[] = ['p."deletedAt" IS NULL'];
    const whereParams: unknown[] = [];
    let whereIndex = 1;

    if (params.categoryId) {
      whereParts.push(`p."categoryId" = $${whereIndex}`);
      whereParams.push(params.categoryId);
      whereIndex += 1;
    }

    if (params.type) {
      whereParts.push(`p."type" = $${whereIndex}`);
      whereParams.push(params.type);
      whereIndex += 1;
    } else if (Array.isArray(params.types) && params.types.length > 0) {
      whereParts.push(`p."type"::text = ANY($${whereIndex}::text[])`);
      whereParams.push(params.types);
      whereIndex += 1;
    }

    if (scopedBranchId) {
      whereParts.push(
        `EXISTS (
           SELECT 1
           FROM product_branches pbx
           WHERE pbx."productId" = p.id
             AND pbx."branchId" = $${whereIndex}
             AND pbx."isActive" = true
         )`,
      );
      whereParams.push(scopedBranchId);
      whereIndex += 1;
    }

    if (params.search?.trim()) {
      const searchPattern = `$${whereIndex}`;
      const normalizedProductName =
        `translate(lower(coalesce(p.name, '')), '${VIETNAMESE_DIACRITICS_FROM}', '${VIETNAMESE_DIACRITICS_TO}')`;
      const normalizedCategoryName =
        `translate(lower(coalesce(c.name, '')), '${VIETNAMESE_DIACRITICS_FROM}', '${VIETNAMESE_DIACRITICS_TO}')`;
      const normalizedSearch =
        `translate(lower(${searchPattern}), '${VIETNAMESE_DIACRITICS_FROM}', '${VIETNAMESE_DIACRITICS_TO}')`;
      const normalizedSku = `lower(coalesce(p.sku, ''))`;
      const loweredSearch = `lower(${searchPattern})`;

      whereParts.push(`(
        ${normalizedProductName} LIKE ${normalizedSearch}
        OR ${normalizedCategoryName} LIKE ${normalizedSearch}
        OR ${normalizedSku} LIKE ${loweredSearch}
      )`);
      whereParams.push(`%${params.search.trim()}%`);
      whereIndex += 1;
    }

    const whereSql = whereParts.join(' AND ');
    const stockSql =
      params.stockStatus === 'in_stock'
        ? 'stock > 0'
        : params.stockStatus === 'out_of_stock'
          ? 'stock <= 0'
          : '1=1';

    const baseCte = `
      WITH product_rows AS (
        SELECT p.id, p.sku, p.name, p."type", p."autoPrice", p.price, p."costPrice", p.unit, p.weight,
               p."timeRateAmount", p."timeRateMinutes",
               COALESCE(SUM(pb.stock), 0) AS stock,
               p."isActive", p."createdAt",
               COALESCE(p."imageThumb", p."imageUrl") AS "imageThumb",
               c.id AS "categoryId", c.name AS "categoryName",
               COALESCE(
                 STRING_AGG(b.name, ', ' ORDER BY b.name) FILTER (WHERE pb."isActive" = true),
                 ''
               ) AS "branchNames",
               COALESCE(
                 JSON_AGG(
                   JSON_BUILD_OBJECT(
                     'branchId', pb."branchId",
                     'branchName', b.name,
                     'isActive', pb."isActive",
                     'stock', pb.stock
                   )
                 ) FILTER (WHERE pb.id IS NOT NULL),
                 '[]'::json
               ) AS "branchConfigs",
               COALESCE(
                 (
                   SELECT JSON_AGG(
                     JSON_BUILD_OBJECT(
                       'itemProductId', pci."itemProductId",
                       'quantity', pci.quantity,
                       'itemName', pi.name,
                       'itemUnit', pi.unit
                     )
                     ORDER BY pi.name
                   )
                   FROM product_combo_items pci
                   INNER JOIN products pi ON pi.id = pci."itemProductId"
                   WHERE pci."comboProductId" = p.id
                 ),
                 '[]'::json
               ) AS "comboItems"
        FROM products p
        LEFT JOIN categories c ON c.id = p."categoryId" AND c."deletedAt" IS NULL
        LEFT JOIN product_branches pb ON pb."productId" = p.id
        LEFT JOIN branches b ON b.id = pb."branchId"
        WHERE ${whereSql}
        GROUP BY p.id, c.id
      )
    `;

    const countRows = await this.db.query<{ total: number }>(
      `${baseCte}
       SELECT COUNT(*)::int AS total
       FROM product_rows
       WHERE ${stockSql}`,
      whereParams,
    );
    const total = Number(countRows[0]?.total || 0);

    const items = await this.db.query(
      `${baseCte}
       SELECT *
       FROM product_rows
       WHERE ${stockSql}
       ORDER BY "createdAt" DESC
       LIMIT $${whereIndex} OFFSET $${whereIndex + 1}`,
      [...whereParams, pageSize, offset],
    );

    const normalizedItems = (items as any[]).map((item) => {
      const baseItem = {
        ...item,
        price: this.toMoney(item.price),
        costPrice: item.costPrice == null ? null : this.toMoney(item.costPrice),
        timeRateAmount: item.timeRateAmount == null ? null : this.toMoney(item.timeRateAmount),
      };
      if (!scopedBranchId) return baseItem;
      const rawConfigs = Array.isArray(item.branchConfigs)
        ? item.branchConfigs
        : typeof item.branchConfigs === 'string'
          ? JSON.parse(item.branchConfigs)
          : [];
      const filteredConfigs = rawConfigs.filter((cfg: any) => cfg?.branchId === scopedBranchId);
      const branchStock = filteredConfigs.reduce((sum: number, cfg: any) => sum + Number(cfg?.stock || 0), 0);
      return {
        ...baseItem,
        stock: branchStock,
        branchNames: filteredConfigs.map((cfg: any) => cfg.branchName).filter(Boolean).join(', '),
        branchConfigs: filteredConfigs,
      };
    });

    return {
      items: normalizedItems,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async getProductById(id: string, user: CurrentUser) {
    const scopedBranchId = this.branchPolicy.resolveReadBranchId(user);
    const rows = await this.db.query(
      `SELECT p.id, p.sku, p.name, p."type", p."autoPrice", p.price, p."costPrice", p.unit, p.weight,
              p."timeRateAmount", p."timeRateMinutes",
              COALESCE(SUM(pb.stock), 0) AS stock,
              p."isActive", p."createdAt",
              p."imageUrl", p."imageThumb",
              c.id AS "categoryId", c.name AS "categoryName",
              COALESCE(
                (
                  SELECT JSON_AGG(
                    JSON_BUILD_OBJECT(
                      'itemProductId', pci."itemProductId",
                      'quantity', pci.quantity,
                      'itemName', pi.name,
                      'itemPrice', pi.price,
                      'itemUnit', pi.unit
                    )
                    ORDER BY pi.name
                  )
                  FROM product_combo_items pci
                  INNER JOIN products pi ON pi.id = pci."itemProductId"
                  WHERE pci."comboProductId" = p.id
                ),
                '[]'::json
              ) AS "comboItems",
              COALESCE(
                JSON_AGG(
                  JSON_BUILD_OBJECT(
                    'branchId', pb."branchId",
                    'branchName', b.name,
                    'isActive', pb."isActive",
                    'stock', pb.stock
                  )
                ) FILTER (WHERE pb.id IS NOT NULL),
                '[]'::json
              ) AS "branchConfigs"
       FROM products p
       LEFT JOIN categories c ON c.id = p."categoryId" AND c."deletedAt" IS NULL
       LEFT JOIN product_branches pb ON pb."productId" = p.id
       LEFT JOIN branches b ON b.id = pb."branchId"
       WHERE p.id = $1 AND p."deletedAt" IS NULL
         AND ($2::text IS NULL OR EXISTS (
           SELECT 1 FROM product_branches pbx
           WHERE pbx."productId" = p.id
             AND pbx."branchId" = $2
         ))
       GROUP BY p.id, c.id
       LIMIT 1`,
      [id, scopedBranchId || null],
    );

    if (!rows[0]) {
      throw new NotFoundException('Hàng hóa không tồn tại');
    }

    if (scopedBranchId) {
      const rawConfigs = Array.isArray(rows[0].branchConfigs)
        ? rows[0].branchConfigs
        : typeof rows[0].branchConfigs === 'string'
          ? JSON.parse(rows[0].branchConfigs)
          : [];
      const filteredConfigs = rawConfigs.filter((cfg: any) => cfg?.branchId === scopedBranchId);
      return {
        ...rows[0],
        price: this.toMoney(rows[0].price),
        costPrice: rows[0].costPrice == null ? null : this.toMoney(rows[0].costPrice),
        timeRateAmount: rows[0].timeRateAmount == null ? null : this.toMoney(rows[0].timeRateAmount),
        stock: filteredConfigs.reduce((sum: number, cfg: any) => sum + Number(cfg?.stock || 0), 0),
        branchConfigs: filteredConfigs,
      };
    }

    return {
      ...rows[0],
      price: this.toMoney(rows[0].price),
      costPrice: rows[0].costPrice == null ? null : this.toMoney(rows[0].costPrice),
      timeRateAmount: rows[0].timeRateAmount == null ? null : this.toMoney(rows[0].timeRateAmount),
    };
  }

  private async normalizeBranchConfigs(branchConfigs: BranchConfigInput[] | undefined, user: CurrentUser) {
    if (!branchConfigs || branchConfigs.length === 0) {
      throw new BadRequestException('Vui lòng chọn ít nhất một chi nhánh cho hàng hóa');
    }

    const sourceConfigs = this.branchPolicy.isAdmin(user)
      ? branchConfigs
      : [{ branchId: this.branchPolicy.resolveWriteBranchId(user), isActive: true, stock: branchConfigs?.[0]?.stock }];

    const branchIds = [...new Set(sourceConfigs.map((item) => item.branchId).filter(Boolean))];
    if (branchIds.length === 0) {
      throw new BadRequestException('Vui lòng chọn ít nhất một chi nhánh cho hàng hóa');
    }

    const existedBranches = await this.db.query<{ id: string }>(
      `SELECT id FROM branches WHERE id = ANY($1::text[])`,
      [branchIds],
    );

    if (existedBranches.length !== branchIds.length) {
      throw new BadRequestException('Có chi nhánh không tồn tại');
    }

    const uniqueBranchConfigs = branchIds.map((branchId) => {
      const matched = sourceConfigs.find((item) => item.branchId === branchId);
      const stock = Number(matched?.stock ?? 0);
      if (!Number.isFinite(stock) || stock < 0) {
        throw new BadRequestException('Tồn kho theo chi nhánh không hợp lệ');
      }
      return { branchId, isActive: matched?.isActive ?? true, stock };
    });

    if (!uniqueBranchConfigs.some((item) => item.isActive)) {
      throw new BadRequestException('Ít nhất một chi nhánh phải ở trạng thái kinh doanh');
    }

    return uniqueBranchConfigs;
  }

  private validateProductInput(input: CreateProductInput) {
    if (!input.name?.trim()) {
      throw new BadRequestException('Tên hàng là bắt buộc');
    }
    if (input.name.trim().length < 2 || input.name.trim().length > 255) {
      throw new BadRequestException('Tên hàng phải từ 2 đến 255 ký tự');
    }

    if (input.sku && !SKU_REGEX.test(input.sku.trim())) {
      throw new BadRequestException('Mã hàng hóa không đúng định dạng');
    }

    const productType = input.type === 'COMBO' || input.type === 'TIME' ? input.type : 'SINGLE';

    if (productType !== 'TIME' && input.unit && !UNIT_REGEX.test(input.unit.trim())) {
      throw new BadRequestException('Đơn vị tính không đúng định dạng');
    }

    if (input.type && !['SINGLE', 'COMBO', 'TIME'].includes(input.type)) {
      throw new BadRequestException('Loại hàng hóa không hợp lệ');
    }

    const weight = Number(input.weight ?? 0);
    if (!Number.isFinite(weight) || weight < 0) {
      throw new BadRequestException('Trọng lượng không hợp lệ');
    }

    const costPrice = this.toMoney(input.costPrice);
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      throw new BadRequestException('Giá vốn không hợp lệ');
    }

    const price = this.toMoney(input.price);
    if (productType !== 'TIME' && (!Number.isFinite(price) || price <= 0)) {
      throw new BadRequestException('Giá bán phải lớn hơn 0');
    }

    if (productType === 'TIME') {
      const timeRateAmount = this.toMoney(input.timeRateAmount);
      const timeRateMinutes = Math.trunc(Number(input.timeRateMinutes) || 0);
      if (timeRateAmount <= 0) {
        throw new BadRequestException('Giá dịch vụ tính giờ phải lớn hơn 0');
      }
      if (timeRateMinutes <= 0) {
        throw new BadRequestException('Thời lượng chuẩn tính giờ phải lớn hơn 0');
      }
    }
  }

  private async normalizeComboItems(comboItems: ComboItemInput[] | undefined, user: CurrentUser) {
    if (!comboItems || comboItems.length === 0) {
      throw new BadRequestException('Combo phải có ít nhất một hàng hóa thành phần');
    }

    const uniqueMap = new Map<string, number>();
    for (const item of comboItems) {
      if (!item?.itemProductId) continue;
      const quantity = Math.max(0, Math.trunc(Number(item.quantity)));
      if (quantity <= 0) {
        throw new BadRequestException('Số lượng thành phần combo không hợp lệ');
      }
      uniqueMap.set(item.itemProductId, (uniqueMap.get(item.itemProductId) || 0) + quantity);
    }

    if (uniqueMap.size === 0) {
      throw new BadRequestException('Combo phải có ít nhất một hàng hóa thành phần');
    }

    const itemIds = [...uniqueMap.keys()];
    const rows = await this.db.query<{ id: string; name: string; price: string; type: string }>(
      'SELECT id, name, price, "type" FROM products WHERE id = ANY($1::text[]) AND "deletedAt" IS NULL',
      [itemIds],
    );

    if (rows.length !== itemIds.length) {
      throw new BadRequestException('Có hàng hóa thành phần không tồn tại');
    }

    if (rows.some((item) => item.type === 'COMBO')) {
      throw new BadRequestException('Tạm thời chưa hỗ trợ thêm combo lồng trong combo');
    }

    if (rows.some((item) => item.type === 'TIME')) {
      throw new BadRequestException('Không hỗ trợ thêm dịch vụ tính giờ vào combo');
    }

    if (!this.branchPolicy.isAdmin(user)) {
      const branchRows = await this.db.query<{ "productId": string }>(
        'SELECT "productId" FROM product_branches WHERE "branchId" = $1 AND "isActive" = true AND "productId" = ANY($2::text[])',
        [user.branchId, itemIds],
      );
      if (branchRows.length !== itemIds.length) {
        throw new BadRequestException('Có hàng hóa thành phần chưa hoạt động tại chi nhánh hiện tại');
      }
    }

    const byId = new Map(rows.map((row) => [row.id, row]));
    const normalized = itemIds.map((itemProductId) => ({
      itemProductId,
      quantity: uniqueMap.get(itemProductId) || 1,
      itemPrice: this.toMoney(byId.get(itemProductId)?.price),
    }));

    const autoPrice = normalized.reduce((sum, item) => sum + item.itemPrice * item.quantity, 0);
    return { normalized, autoPrice };
  }

  async createProduct(input: CreateProductInput, user: CurrentUser) {
    this.validateProductInput(input);

    if (input.categoryId) {
      const category = await this.db.query(
        'SELECT id FROM categories WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
        [input.categoryId],
      );
      if (!category[0]) {
        throw new BadRequestException('Nhóm hàng không tồn tại');
      }
    }

    const productType = input.type === 'COMBO' || input.type === 'TIME' ? input.type : 'SINGLE';
    const uniqueBranchConfigs = await this.normalizeBranchConfigs(input.branchConfigs, user);
    const totalStock = uniqueBranchConfigs.reduce((sum, item) => sum + item.stock, 0);
    let comboItemsPayload: { itemProductId: string; quantity: number; itemPrice: number }[] = [];
    let finalPrice = this.toMoney(input.price);
    if (productType === 'COMBO') {
      const comboPayload = await this.normalizeComboItems(input.comboItems, user);
      comboItemsPayload = comboPayload.normalized;
      if (input.autoPrice ?? true) {
        finalPrice = comboPayload.autoPrice;
      }
    }
    if (productType === 'TIME') {
      finalPrice = this.toMoney(input.timeRateAmount);
    }

    const id = randomUUID();
    const sku = input.sku?.trim() || `HH${Date.now()}`;
    const rows = await this.db.query(
      `INSERT INTO products
       (id, name, sku, "type", "autoPrice", price, "costPrice", "categoryId", unit, weight, stock, "isActive", "timeRateAmount", "timeRateMinutes", "createdAt", "updatedAt", "imageUrl", "imageThumb")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW(), $15, $16)
       RETURNING id, name, sku, "type", "autoPrice", price, "costPrice", "categoryId", unit, weight, stock, "isActive", "timeRateAmount", "timeRateMinutes", "createdAt", "imageUrl", "imageThumb"`,
      [
        id,
        input.name.trim(),
        sku,
        productType,
        productType === 'COMBO' ? input.autoPrice ?? true : false,
        finalPrice,
        input.costPrice != null ? this.toMoney(input.costPrice) : null,
        input.categoryId || null,
        productType === 'TIME' ? null : (input.unit?.trim() || null),
        productType === 'TIME' ? null : (input.weight != null ? Number(input.weight) : null),
        totalStock,
        input.isActive ?? true,
        productType === 'TIME' ? this.toMoney(input.timeRateAmount) : null,
        productType === 'TIME' ? Math.max(1, Math.trunc(Number(input.timeRateMinutes) || 0)) : null,
        input.imageUrl ?? null,
        input.imageThumb ?? null,
      ],
    );

    for (const branchConfig of uniqueBranchConfigs) {
      await this.db.query(
        `INSERT INTO product_branches (id, "productId", "branchId", "isActive", stock, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [randomUUID(), id, branchConfig.branchId, branchConfig.isActive, branchConfig.stock],
      );
    }

    if (productType === 'COMBO') {
      for (const comboItem of comboItemsPayload) {
        await this.db.query(
          `INSERT INTO product_combo_items (id, "comboProductId", "itemProductId", quantity, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, NOW(), NOW())`,
          [randomUUID(), id, comboItem.itemProductId, comboItem.quantity],
        );
      }
    }

    return rows[0];
  }

  async updateProduct(id: string, input: CreateProductInput, user: CurrentUser) {
    const existed = await this.db.query<{ id: string; imageUrl: string | null }>(
      'SELECT id, "imageUrl" FROM products WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
      [id],
    );
    if (!existed[0]) {
      throw new NotFoundException('Hàng hóa không tồn tại');
    }

    if (!this.branchPolicy.isAdmin(user)) {
      const branchRef = await this.db.query<{ id: string }>(
        'SELECT id FROM product_branches WHERE "productId" = $1 AND "branchId" = $2 LIMIT 1',
        [id, user.branchId],
      );
      if (!branchRef[0]) {
        throw new NotFoundException('Hàng hóa không tồn tại');
      }
    }

    this.validateProductInput(input);

    if (input.categoryId) {
      const category = await this.db.query(
        'SELECT id FROM categories WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
        [input.categoryId],
      );
      if (!category[0]) {
        throw new BadRequestException('Nhóm hàng không tồn tại');
      }
    }

    const productType = input.type === 'COMBO' || input.type === 'TIME' ? input.type : 'SINGLE';
    const uniqueBranchConfigs = await this.normalizeBranchConfigs(input.branchConfigs, user);
    const totalStock = uniqueBranchConfigs.reduce((sum, item) => sum + item.stock, 0);
    let comboItemsPayload: { itemProductId: string; quantity: number; itemPrice: number }[] = [];
    let finalPrice = this.toMoney(input.price);
    if (productType === 'COMBO') {
      const comboPayload = await this.normalizeComboItems(input.comboItems, user);
      comboItemsPayload = comboPayload.normalized.filter((item) => item.itemProductId !== id);
      if (comboItemsPayload.length === 0) {
        throw new BadRequestException('Combo phải có ít nhất một hàng hóa thành phần');
      }
      if (input.autoPrice ?? true) {
        finalPrice = comboPayload.autoPrice;
      }
    }
    if (productType === 'TIME') {
      finalPrice = this.toMoney(input.timeRateAmount);
    }

    await this.db.query(
      `UPDATE products
       SET name = $1, sku = $2, "type" = $3, "autoPrice" = $4, price = $5, "costPrice" = $6, "categoryId" = $7,
           unit = $8, weight = $9, stock = $10, "isActive" = $11,
           "timeRateAmount" = $12, "timeRateMinutes" = $13,
           "updatedAt" = NOW(), "imageUrl" = $14, "imageThumb" = $15
       WHERE id = $16`,
      [
        input.name.trim(),
        input.sku?.trim() || `HH${Date.now()}`,
        productType,
        productType === 'COMBO' ? input.autoPrice ?? true : false,
        finalPrice,
        input.costPrice != null ? this.toMoney(input.costPrice) : null,
        input.categoryId || null,
        productType === 'TIME' ? null : (input.unit?.trim() || null),
        productType === 'TIME' ? null : (input.weight != null ? Number(input.weight) : null),
        totalStock,
        input.isActive ?? true,
        productType === 'TIME' ? this.toMoney(input.timeRateAmount) : null,
        productType === 'TIME' ? Math.max(1, Math.trunc(Number(input.timeRateMinutes) || 0)) : null,
        input.imageUrl ?? null,
        input.imageThumb ?? null,
        id,
      ],
    );

    await this.db.query('DELETE FROM product_branches WHERE "productId" = $1', [id]);
    for (const branchConfig of uniqueBranchConfigs) {
      await this.db.query(
        `INSERT INTO product_branches (id, "productId", "branchId", "isActive", stock, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [randomUUID(), id, branchConfig.branchId, branchConfig.isActive, branchConfig.stock],
      );
    }

    await this.db.query('DELETE FROM product_combo_items WHERE "comboProductId" = $1', [id]);
    if (productType === 'COMBO') {
      for (const comboItem of comboItemsPayload) {
        await this.db.query(
          `INSERT INTO product_combo_items (id, "comboProductId", "itemProductId", quantity, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, NOW(), NOW())`,
          [randomUUID(), id, comboItem.itemProductId, comboItem.quantity],
        );
      }
    }

    const rows = await this.db.query(
      `SELECT id, name, sku, "type", "autoPrice", price, "costPrice", "categoryId", unit, weight, stock, "isActive", "timeRateAmount", "timeRateMinutes", "createdAt", "imageUrl", "imageThumb"
       FROM products
       WHERE id = $1
       LIMIT 1`,
      [id],
    );

    return rows[0];
  }

  async deleteProduct(id: string, user: CurrentUser) {
    const existed = await this.db.query<{ id: string; imageUrl: string | null }>(
      'SELECT id, "imageUrl" FROM products WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
      [id],
    );
    if (!existed[0]) {
      throw new NotFoundException('Hàng hóa không tồn tại');
    }

    if (!this.branchPolicy.isAdmin(user)) {
      const branchRef = await this.db.query<{ id: string }>(
        'SELECT id FROM product_branches WHERE "productId" = $1 AND "branchId" = $2 LIMIT 1',
        [id, user.branchId],
      );
      if (!branchRef[0]) {
        throw new NotFoundException('Hàng hóa không tồn tại');
      }
    }

    const result = await this.db.withTransaction(async (tx) => {
      const impactedOrders = await tx.query<{
        orderId: string;
        orderState: 'DRAFT' | 'PARTIAL' | 'PAID' | 'UNPAID' | 'DELETED';
        paidAmount: string;
        discountMode: 'percent' | 'amount';
        discountValue: string;
        surchargeMode: 'percent' | 'amount';
        surchargeValue: string;
      }>(
        `SELECT DISTINCT od.id AS "orderId",
                        od."orderState" AS "orderState",
                        od."paidAmount"::text AS "paidAmount",
                        od."discountMode"::text AS "discountMode",
                        od."discountValue"::text AS "discountValue",
                        od."surchargeMode"::text AS "surchargeMode",
                        od."surchargeValue"::text AS "surchargeValue"
         FROM orders od
         INNER JOIN order_items oi ON oi."orderId" = od.id
         WHERE oi."productId" = $1`,
        [id],
      );

      const removedRows = await tx.query<{ removedCount: string }>(
        `WITH deleted_rows AS (
           DELETE FROM order_items
           WHERE "productId" = $1
           RETURNING id
         )
         SELECT COUNT(*)::text AS "removedCount" FROM deleted_rows`,
        [id],
      );
      const removedItems = Number(removedRows[0]?.removedCount || '0');

      for (const order of impactedOrders) {
        const itemCountRows = await tx.query<{ itemCount: string }>(
          'SELECT COUNT(*)::text AS "itemCount" FROM order_items WHERE "orderId" = $1',
          [order.orderId],
        );
        const itemCount = Number(itemCountRows[0]?.itemCount || '0');

        const subtotalRows = await tx.query<{ subtotal: string }>(
          'SELECT COALESCE(SUM("totalPrice"), 0)::text AS subtotal FROM order_items WHERE "orderId" = $1',
          [order.orderId],
        );
        const itemDiscountRows = await tx.query<{ total: string }>(
          'SELECT COALESCE(SUM("lineDiscountAmount"), 0)::text AS total FROM order_items WHERE "orderId" = $1',
          [order.orderId],
        );
        const subtotalAmount = this.toMoney(subtotalRows[0]?.subtotal || 0);
        const itemDiscountTotal = this.toMoney(itemDiscountRows[0]?.total || 0);

        const discountValue = Math.max(0, Number(order.discountValue || 0));
        const surchargeValue = Math.max(0, Number(order.surchargeValue || 0));
        const invoiceDiscountAmount =
          order.discountMode === 'percent'
            ? this.toMoney(Math.min(subtotalAmount, (subtotalAmount * discountValue) / 100))
            : Math.min(subtotalAmount, this.toMoney(discountValue));
        const surchargeAmount =
          order.surchargeMode === 'percent'
            ? this.toMoney((subtotalAmount * surchargeValue) / 100)
            : this.toMoney(surchargeValue);
        const finalAmount = Math.max(0, subtotalAmount - invoiceDiscountAmount + surchargeAmount);
        const paidAmount = Math.max(0, this.toMoney(order.paidAmount));
        const nextOrderState = paidAmount === 0
          ? (finalAmount === 0 ? 'PAID' : 'UNPAID')
          : (paidAmount >= finalAmount ? 'PAID' : 'PARTIAL');

        await tx.query(
          `UPDATE orders
           SET "totalAmount" = $2,
               "discountAmount" = $3,
               "surchargeAmount" = $4,
               "finalAmount" = $5,
               "paidAmount" = $6,
               "orderState" = $7::"OrderLifecycleState",
               "updatedAt" = NOW()
           WHERE id = $1`,
          [order.orderId, subtotalAmount, itemDiscountTotal, surchargeAmount, finalAmount, paidAmount, nextOrderState],
        );

        await tx.query(
          `INSERT INTO order_logs (id, "orderId", action, detail, snapshot, "createdBy", "createdAt")
           VALUES ($1, $2, $3::"OrderLogAction", $4, CAST($5 AS jsonb), $6, NOW())`,
          [
            randomUUID(),
            order.orderId,
            'UPDATE_ORDER',
            'Hệ thống tự động cập nhật hóa đơn do xóa hàng hóa',
            JSON.stringify({
              source: 'PRODUCT_DELETE',
              removedProductId: id,
              subtotalAmount,
              discountAmount: itemDiscountTotal,
              invoiceDiscountAmount,
              surchargeAmount,
              finalAmount,
              paidAmount,
              orderState: nextOrderState,
              itemCount,
            }),
            user.id,
          ],
        );
      }

      await tx.query('UPDATE products SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1', [id]);

      return {
        affectedOrders: impactedOrders.length,
        removedItems,
      };
    });

    return {
      success: true,
      ...result,
    };
  }

  async getProductDeleteImpact(id: string, user: CurrentUser) {
    const existed = await this.db.query<{ id: string }>(
      'SELECT id FROM products WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
      [id],
    );
    if (!existed[0]) {
      throw new NotFoundException('Hàng hóa không tồn tại');
    }

    if (!this.branchPolicy.isAdmin(user)) {
      const branchRef = await this.db.query<{ id: string }>(
        'SELECT id FROM product_branches WHERE "productId" = $1 AND "branchId" = $2 LIMIT 1',
        [id, user.branchId],
      );
      if (!branchRef[0]) {
        throw new NotFoundException('Hàng hóa không tồn tại');
      }
    }

    const impactedOrders = await this.db.query<ProductDeleteImpactOrder>(
      `SELECT od.id AS "orderId",
              od."orderCode" AS "orderCode",
              od."orderState" AS "orderState",
              od."createdAt"::text AS "createdAt",
              COUNT(oi.id)::int AS "itemCount"
       FROM orders od
       INNER JOIN order_items oi ON oi."orderId" = od.id
       WHERE oi."productId" = $1
       GROUP BY od.id
       ORDER BY od."createdAt" DESC`,
      [id],
    );

    return {
      totalOrders: impactedOrders.length,
      orders: impactedOrders,
    };
  }

  async listCategories() {
    return this.db.query(
      `SELECT c.id, c.name, c."isActive", c."createdAt", COUNT(p.id)::int AS "productCount"
       FROM categories c
       LEFT JOIN products p ON p."categoryId" = c.id AND p."deletedAt" IS NULL
       WHERE c."deletedAt" IS NULL
       GROUP BY c.id
       ORDER BY c.name ASC`,
    );
  }

  async createCategory(name: string) {
    if (!name?.trim()) {
      throw new BadRequestException('Tên nhóm hàng là bắt buộc');
    }
    if (!CATEGORY_NAME_REGEX.test(name.trim())) {
      throw new BadRequestException('Tên nhóm hàng không đúng định dạng (2-100 ký tự)');
    }

    const duplicated = await this.db.query(
      'SELECT id FROM categories WHERE LOWER(name) = LOWER($1) AND "deletedAt" IS NULL LIMIT 1',
      [name.trim()],
    );
    if (duplicated[0]) {
      throw new BadRequestException('Tên nhóm hàng đã tồn tại');
    }

    const rows = await this.db.query(
      `INSERT INTO categories (id, name, "sortOrder", "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, 0, true, NOW(), NOW())
       RETURNING id, name, "isActive", "createdAt"`,
      [randomUUID(), name.trim()],
    );

    return rows[0];
  }

  async updateCategory(id: string, input: UpdateCategoryInput) {
    if (!input.name?.trim()) {
      throw new BadRequestException('Tên nhóm hàng là bắt buộc');
    }
    if (!CATEGORY_NAME_REGEX.test(input.name.trim())) {
      throw new BadRequestException('Tên nhóm hàng không đúng định dạng (2-100 ký tự)');
    }

    const existed = await this.db.query(
      'SELECT id, name FROM categories WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
      [id],
    );
    if (!existed[0]) {
      throw new NotFoundException('Nhóm hàng không tồn tại');
    }

    const duplicated = await this.db.query(
      'SELECT id FROM categories WHERE LOWER(name) = LOWER($1) AND id <> $2 AND "deletedAt" IS NULL LIMIT 1',
      [input.name.trim(), id],
    );
    if (duplicated[0]) {
      throw new BadRequestException('Tên nhóm hàng đã tồn tại');
    }

    const rows = await this.db.query(
      `UPDATE categories
       SET name = $1, "updatedAt" = NOW()
       WHERE id = $2
       RETURNING id, name, "isActive", "createdAt", "updatedAt"`,
      [input.name.trim(), id],
    );

    return rows[0];
  }

  async deleteCategory(id: string) {
    const existed = await this.db.query('SELECT id FROM categories WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1', [id]);
    if (!existed[0]) {
      throw new NotFoundException('Nhóm hàng không tồn tại');
    }

    const productCountRows = await this.db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM products WHERE "categoryId" = $1 AND "deletedAt" IS NULL',
      [id],
    );
    const affectedProductCount = Number(productCountRows[0]?.count || '0');

    if (affectedProductCount > 0) {
      await this.db.query(
        'UPDATE products SET "categoryId" = NULL, "updatedAt" = NOW() WHERE "categoryId" = $1 AND "deletedAt" IS NULL',
        [id],
      );
    }

    await this.db.query('UPDATE categories SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1', [id]);

    return {
      success: true,
      affectedProductCount,
      message:
        affectedProductCount > 0
          ? `Đã xóa nhóm hàng và gỡ liên kết ${affectedProductCount} mặt hàng khỏi nhóm.`
          : 'Đã xóa nhóm hàng thành công',
    };
  }
}
