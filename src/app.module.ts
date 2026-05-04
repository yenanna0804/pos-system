import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { BranchModule } from './modules/branches/branch.module';
import { ProductsModule } from './modules/products/products.module';
import { TablesModule } from './modules/tables/tables.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ReportsModule } from './modules/reports/reports.module';
import { HealthController } from './health.controller';

@Module({
  imports: [DatabaseModule, AuthModule, BranchModule, ProductsModule, TablesModule, OrdersModule, ReportsModule],
  controllers: [HealthController],
})
export class AppModule {}
