import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../../common/auth.types';
import { OrdersService } from './orders.service';

type CreateOrderDto = {
  entityType: 'TABLE' | 'ROOM';
  tableId?: string;
  roomId?: string;
  customerName?: string;
  totalAmount: number;
  discountAmount?: number;
  surchargeAmount?: number;
  billItems: {
    lineId: string;
    productId: string;
    productName: string;
    unit?: string;
    baseUnitPrice?: number;
    unitPrice: number;
    quantity: number;
    note: string;
  }[];
  branchId?: string;
};

type UpdatePaymentDto = {
  paidAmount: number;
};

type UpdateOrderDto = {
  entityType?: 'TABLE' | 'ROOM';
  tableId?: string;
  roomId?: string;
  customerName?: string;
  totalAmount?: number;
  discountAmount?: number;
  surchargeAmount?: number;
  billItems?: {
    lineId: string;
    productId: string;
    productName: string;
    unit?: string;
    baseUnitPrice?: number;
    unitPrice: number;
    quantity: number;
    note: string;
  }[];
};

@Controller()
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get('orders')
  listOrders(
    @CurrentUser() user: CurrentUserType,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('orderStates') orderStates?: string,
    @Query('statuses') legacyStatuses?: string,
    @Query('areaId') areaId?: string,
    @Query('roomId') roomId?: string,
    @Query('tableId') tableId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.ordersService.listOrders(user, {
      branchId,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 10,
      search,
      orderStates: (orderStates || legacyStatuses)
        ? (orderStates || legacyStatuses)?.split(',').map((v) => v.trim()).filter(Boolean)
        : undefined,
      areaId,
      roomId,
      tableId,
      startDate,
      endDate,
    });
  }

  @Post('orders')
  createOrder(@CurrentUser() user: CurrentUserType, @Body() dto: CreateOrderDto) {
    return this.ordersService.createOrder(user, dto);
  }

  @Get('orders/:id')
  getOrderById(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.ordersService.getOrderById(user, id);
  }

  @Patch('orders/:id')
  updateOrder(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() dto: UpdateOrderDto) {
    return this.ordersService.updateOrder(user, id, dto);
  }

  @Post('orders/:id/print')
  printOrder(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.ordersService.printOrder(user, id);
  }

  @Get('orders/:id/logs')
  getOrderLogs(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.ordersService.getOrderLogs(user, id);
  }

  @Patch('orders/:id/payment')
  updatePayment(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() dto: UpdatePaymentDto) {
    return this.ordersService.updatePayment(user, id, dto.paidAmount);
  }

  @Delete('orders/:id')
  deleteOrder(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.ordersService.markDeleted(user, id);
  }
}
