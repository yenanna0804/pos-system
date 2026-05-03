import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BranchPolicyService } from '../../common/branch-policy.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderPricingService } from './order-pricing.service';

@Module({
  imports: [AuthModule],
  controllers: [OrdersController],
  providers: [OrdersService, BranchPolicyService, OrderPricingService],
})
export class OrdersModule {}
