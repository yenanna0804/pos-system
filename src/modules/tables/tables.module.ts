import { Module } from '@nestjs/common';
import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';
import { AuthModule } from '../auth/auth.module';
import { BranchPolicyService } from '../../common/branch-policy.service';

@Module({
  imports: [AuthModule],
  controllers: [TablesController],
  providers: [TablesService, BranchPolicyService],
})
export class TablesModule {}
