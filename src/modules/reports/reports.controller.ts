import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../../common/auth.types';
import { ReportsService } from './reports.service';
import { RequiresPermission, Permission } from '../../common/permissions';

@Controller('reports')
@RequiresPermission(Permission.REPORTS_ACCESS)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('sales/end-of-day')
  getSalesEndOfDayReport(
    @CurrentUser() user: CurrentUserType,
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
    @Query('orderStates') orderStates?: string,
    @Query('areaId') areaId?: string,
    @Query('roomId') roomId?: string,
    @Query('tableId') tableId?: string,
    @Query('paymentMethod') paymentMethod?: 'CASH' | 'BANKING',
  ) {
    return this.reportsService.getSalesEndOfDayReport(user, {
      branchId,
      startDate,
      endDate,
      search,
      orderStates: orderStates?.split(',').map((v) => v.trim()).filter(Boolean),
      areaId,
      roomId,
      tableId,
      paymentMethod,
    });
  }

  @Get('products')
  getProductReport(
    @CurrentUser() user: CurrentUserType,
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
    @Query('type') type?: 'SINGLE' | 'COMBO' | 'TIME',
    @Query('stockStatus') stockStatus?: 'all' | 'in_stock' | 'out_of_stock',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.reportsService.getProductReport(user, {
      branchId,
      startDate,
      endDate,
      categoryId,
      search,
      type,
      stockStatus,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 100,
    });
  }
}
