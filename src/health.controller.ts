import { Controller, Get } from '@nestjs/common';
import { DbService } from './database/db.service';
import { Public } from './common/auth.guard';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Get('schema')
  async schema() {
    if ((process.env.DB_DIALECT ?? 'postgres') === 'sqlite') {
      const rows = await this.db.query<{ name: string }>(
        `SELECT name
         FROM pragma_table_info('orders')
         WHERE name IN ($1, $2, $3, $4)`,
        ['discountMode', 'discountValue', 'surchargeMode', 'surchargeValue'],
      );
      const found = new Set(rows.map((row) => row.name));
      const requiredColumns = ['discountMode', 'discountValue', 'surchargeMode', 'surchargeValue'];
      const missingColumns = requiredColumns.filter((columnName) => !found.has(columnName));
      return {
        ok: missingColumns.length === 0,
        requiredColumns,
        missingColumns,
      };
    }

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
