import { Controller, Get } from '@nestjs/common';
import { PgService } from './database/pg.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: PgService) {}

  @Get('schema')
  async schema() {
    const requiredColumns = ['discountMode', 'discountValue', 'surchargeMode', 'surchargeValue'];
    const rows = await this.db.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'orders'
         AND column_name = ANY($1::text[])`,
      [requiredColumns],
    );
    const found = new Set(rows.map((row) => row.column_name));
    const missingColumns = requiredColumns.filter((columnName) => !found.has(columnName));
    return {
      ok: missingColumns.length === 0,
      requiredColumns,
      missingColumns,
    };
  }
}
