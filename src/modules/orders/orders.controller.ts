import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../../common/auth.types';
import { OrdersService } from './orders.service';
import { RequiresPermission, Permission } from '../../common/permissions';

type CreateOrderDto = {
  entityType?: 'TABLE' | 'ROOM';
  tableId?: string;
  roomId?: string;
  customerName?: string;
  totalAmount: number;
  discountAmount?: number;
  discountMode?: 'percent' | 'amount';
  discountValue?: number;
  surchargeAmount?: number;
  surchargeMode?: 'percent' | 'amount';
  surchargeValue?: number;
  paidAmount?: number;
  paymentMethod?: 'CASH' | 'BANKING';
  orderState?: 'DRAFT' | 'PAID' | 'PARTIAL' | 'UNPAID';
  billItems: {
    lineId: string;
    productId: string;
    productName: string;
    unit?: string;
    baseUnitPrice?: number;
    unitPrice: number;
    quantity: number;
    note: string;
    pricingTypeSnapshot?: 'FIXED' | 'TIME';
    timeRateAmountSnapshot?: number;
    timeRateMinutesSnapshot?: number;
    usedMinutes?: number;
    startAt?: string | null;
    stopAt?: string | null;
    lineDiscountAmount?: number;
    lineSurchargeAmount?: number;
  }[];
  branchId?: string;
  applySaveStatusRules?: boolean;
};

type UpdateOrderDto = {
  entityType?: 'TABLE' | 'ROOM';
  tableId?: string;
  roomId?: string;
  customerName?: string;
  totalAmount?: number;
  discountAmount?: number;
  discountMode?: 'percent' | 'amount';
  discountValue?: number;
  surchargeAmount?: number;
  surchargeMode?: 'percent' | 'amount';
  surchargeValue?: number;
  paidAmount?: number;
  paymentMethod?: 'CASH' | 'BANKING';
  orderState?: 'DRAFT' | 'PAID' | 'PARTIAL' | 'UNPAID';
  billItems?: {
    lineId: string;
    productId: string;
    productName: string;
    unit?: string;
    baseUnitPrice?: number;
    unitPrice: number;
    quantity: number;
    note: string;
    pricingTypeSnapshot?: 'FIXED' | 'TIME';
    timeRateAmountSnapshot?: number;
    timeRateMinutesSnapshot?: number;
    usedMinutes?: number;
    startAt?: string | null;
    stopAt?: string | null;
    lineDiscountAmount?: number;
    lineSurchargeAmount?: number;
  }[];
  billItemsPatch?: {
    addedItems?: {
      lineId?: string;
      productId: string;
      productName: string;
      unit?: string;
      baseUnitPrice?: number;
      unitPrice: number;
      quantity: number;
      note: string;
      pricingTypeSnapshot?: 'FIXED' | 'TIME';
      timeRateAmountSnapshot?: number;
      timeRateMinutesSnapshot?: number;
      usedMinutes?: number;
      startAt?: string | null;
      stopAt?: string | null;
      lineDiscountAmount?: number;
      lineSurchargeAmount?: number;
    }[];
    updatedItems?: {
      lineId: string;
      productId?: string;
      productName?: string;
      unit?: string;
      baseUnitPrice?: number;
      unitPrice?: number;
      quantity?: number;
      note?: string;
      pricingTypeSnapshot?: 'FIXED' | 'TIME';
      timeRateAmountSnapshot?: number;
      timeRateMinutesSnapshot?: number;
      usedMinutes?: number;
      startAt?: string | null;
      stopAt?: string | null;
      lineDiscountAmount?: number;
      lineSurchargeAmount?: number;
    }[];
    removedItemIds?: string[];
  };
  applySaveStatusRules?: boolean;
};

@Controller()
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
    @Query('paymentMethod') paymentMethod?: 'CASH' | 'BANKING',
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
      paymentMethod,
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

  @Delete('orders/:id')
  @RequiresPermission(Permission.ORDERS_DELETE)
  deleteOrder(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.ordersService.markDeleted(user, id);
  }

  @Delete('orders/:id/hard')
  @RequiresPermission(Permission.ORDERS_DELETE)
  hardDeleteOrder(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.ordersService.hardDelete(user, id);
  }

  @Post('orders/:id/items/:lineId/timer/start')
  startTimer(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Param('lineId') lineId: string) {
    return this.ordersService.startTimer(user, id, lineId);
  }

  @Post('orders/:id/items/:lineId/timer/stop')
  stopTimer(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Param('lineId') lineId: string) {
    return this.ordersService.stopTimer(user, id, lineId);
  }

  @Post('orders/:id/commands/start-time-line')
  startTimeLine(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: { clientLineId: string; lineSnapshot: { productId: string; productName?: string; unitPrice?: number; timeRateAmountSnapshot?: number; timeRateMinutesSnapshot?: number; note?: string } },
  ) {
    return this.ordersService.startTimeLine(user, id, dto);
  }

}
