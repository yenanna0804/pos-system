import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { PgService } from '../../database/pg.service';
import { MinioService } from './minio.service';

type CreateProductInput = {
  sku?: string;
  name: string;
  categoryId?: string | null;
  unit?: string;
  weight?: number;
  costPrice?: number;
  price: number;
  stock?: number;
  isActive?: boolean;
  branchConfigs?: { branchId: string; isActive: boolean }[];
  imageUrl?: string | null;
};

type BranchConfigInput = { branchId: string; isActive: boolean };
const SKU_REGEX = /^[A-Za-z0-9_-]{3,50}$/;
const UNIT_REGEX = /^[\p{L}\p{N}\s./-]{1,30}$/u;
const CATEGORY_NAME_REGEX = /^[\p{L}\p{N}\s&()./-]{2,100}$/u;

type UpdateCategoryInput = {
  name: string;
};

@Injectable()
export class ProductsService {
  constructor(
    private db: PgService,
    private minioService: MinioService,
  ) {}

  async processAndSaveImage(file: Express.Multer.File) {
    const acceptedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!acceptedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Ảnh phải là định dạng JPG, PNG hoặc WEBP');
    }

    const processed = await sharp(file.buffer)
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    try {
      const result = await this.minioService.uploadProductImage(processed, 'image/webp');
      return { imageUrl: result.imageUrl };
    } catch {
      throw new BadRequestException('Upload ảnh thất bại. Vui lòng kiểm tra cấu hình MinIO');
    }
  }

  async listProducts() {
    return this.db.query(
      `SELECT p.id, p.sku, p.name, p.price, p."costPrice", p.unit, p.weight, p.stock, p."isActive", p."createdAt",
              p."imageUrl",
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
                    'isActive', pb."isActive"
                  )
                ) FILTER (WHERE pb.id IS NOT NULL),
                '[]'::json
              ) AS "branchConfigs"
       FROM products p
       LEFT JOIN categories c ON c.id = p."categoryId" AND c."deletedAt" IS NULL
       LEFT JOIN product_branches pb ON pb."productId" = p.id
       LEFT JOIN branches b ON b.id = pb."branchId"
       WHERE p."deletedAt" IS NULL
       GROUP BY p.id, c.id
       ORDER BY p."createdAt" DESC`,
    );
  }

  private async normalizeBranchConfigs(branchConfigs?: BranchConfigInput[]) {
    if (!branchConfigs || branchConfigs.length === 0) {
      throw new BadRequestException('Vui lòng chọn ít nhất một chi nhánh cho hàng hóa');
    }

    const branchIds = [...new Set(branchConfigs.map((item) => item.branchId).filter(Boolean))];
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
      const matched = branchConfigs.find((item) => item.branchId === branchId);
      return { branchId, isActive: matched?.isActive ?? true };
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

    if (input.unit && !UNIT_REGEX.test(input.unit.trim())) {
      throw new BadRequestException('Đơn vị tính không đúng định dạng');
    }

    const weight = Number(input.weight ?? 0);
    if (!Number.isFinite(weight) || weight < 0) {
      throw new BadRequestException('Trọng lượng không hợp lệ');
    }

    const stock = Number(input.stock ?? 0);
    if (!Number.isFinite(stock) || stock < 0) {
      throw new BadRequestException('Tồn kho không hợp lệ');
    }

    const costPrice = Number(input.costPrice ?? 0);
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      throw new BadRequestException('Giá vốn không hợp lệ');
    }

    const price = Number(input.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new BadRequestException('Giá bán phải lớn hơn 0');
    }
  }

  async createProduct(input: CreateProductInput) {
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

    const uniqueBranchConfigs = await this.normalizeBranchConfigs(input.branchConfigs);

    const id = randomUUID();
    const sku = input.sku?.trim() || `HH${Date.now()}`;
    const rows = await this.db.query(
      `INSERT INTO products
       (id, name, sku, price, "costPrice", "categoryId", unit, weight, stock, "isActive", "createdAt", "updatedAt", "imageUrl")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), $11)
       RETURNING id, name, sku, price, "costPrice", "categoryId", unit, weight, stock, "isActive", "createdAt", "imageUrl"`,
      [
        id,
        input.name.trim(),
        sku,
        Number(input.price),
        input.costPrice != null ? Number(input.costPrice) : null,
        input.categoryId || null,
        input.unit?.trim() || null,
        input.weight != null ? Number(input.weight) : null,
        input.stock != null ? Number(input.stock) : 0,
        input.isActive ?? true,
        input.imageUrl ?? null,
      ],
    );

    for (const branchConfig of uniqueBranchConfigs) {
      await this.db.query(
        `INSERT INTO product_branches (id, "productId", "branchId", "isActive", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [randomUUID(), id, branchConfig.branchId, branchConfig.isActive],
      );
    }

    return rows[0];
  }

  async updateProduct(id: string, input: CreateProductInput) {
    const existed = await this.db.query<{ id: string; imageUrl: string | null }>(
      'SELECT id, "imageUrl" FROM products WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
      [id],
    );
    if (!existed[0]) {
      throw new NotFoundException('Hàng hóa không tồn tại');
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

    const uniqueBranchConfigs = await this.normalizeBranchConfigs(input.branchConfigs);

    await this.db.query(
      `UPDATE products
       SET name = $1, sku = $2, price = $3, "costPrice" = $4, "categoryId" = $5,
           unit = $6, weight = $7, stock = $8, "isActive" = $9, "updatedAt" = NOW(), "imageUrl" = $10
       WHERE id = $11`,
      [
        input.name.trim(),
        input.sku?.trim() || `HH${Date.now()}`,
        Number(input.price),
        input.costPrice != null ? Number(input.costPrice) : null,
        input.categoryId || null,
        input.unit?.trim() || null,
        input.weight != null ? Number(input.weight) : null,
        input.stock != null ? Number(input.stock) : 0,
        input.isActive ?? true,
        input.imageUrl ?? null,
        id,
      ],
    );

    await this.db.query('DELETE FROM product_branches WHERE "productId" = $1', [id]);
    for (const branchConfig of uniqueBranchConfigs) {
      await this.db.query(
        `INSERT INTO product_branches (id, "productId", "branchId", "isActive", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [randomUUID(), id, branchConfig.branchId, branchConfig.isActive],
      );
    }

    const rows = await this.db.query(
      `SELECT id, name, sku, price, "costPrice", "categoryId", unit, weight, stock, "isActive", "createdAt", "imageUrl"
       FROM products
       WHERE id = $1
       LIMIT 1`,
      [id],
    );

    const oldImageUrl = existed[0].imageUrl;
    const newImageUrl = input.imageUrl ?? null;
    if (oldImageUrl && oldImageUrl !== newImageUrl) {
      await this.minioService.deleteProductImageByUrl(oldImageUrl);
    }

    return rows[0];
  }

  async deleteProduct(id: string) {
    const existed = await this.db.query<{ id: string; imageUrl: string | null }>(
      'SELECT id, "imageUrl" FROM products WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1',
      [id],
    );
    if (!existed[0]) {
      throw new NotFoundException('Hàng hóa không tồn tại');
    }

    const orderRefs = await this.db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM order_items WHERE "productId" = $1',
      [id],
    );
    if (Number(orderRefs[0]?.count || '0') > 0) {
      throw new BadRequestException('Hàng hóa đã có trong hóa đơn, không thể xóa');
    }

    await this.db.query('UPDATE products SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1', [id]);

    if (existed[0].imageUrl) {
      await this.minioService.deleteProductImageByUrl(existed[0].imageUrl);
    }

    return { success: true };
  }

  async deleteImage(imageUrl: string) {
    if (!imageUrl) {
      throw new BadRequestException('Thiếu imageUrl');
    }
    await this.minioService.deleteProductImageByUrl(imageUrl);
    return { success: true };
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
