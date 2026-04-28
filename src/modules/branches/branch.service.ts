import { Injectable } from '@nestjs/common';
import { PgService } from '../../database/pg.service';

@Injectable()
export class BranchService {
  constructor(private db: PgService) {}

  async findAll() {
    return this.db.query(
      `SELECT id, name, address, phone, "isActive", "createdAt", "updatedAt"
       FROM branches
       WHERE "isActive" = true
       ORDER BY name ASC`,
    );
  }

  async findById(id: string) {
    const rows = await this.db.query(
      `SELECT id, name, address, phone, "isActive", "createdAt", "updatedAt"
       FROM branches
       WHERE id = $1
       LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }
}
