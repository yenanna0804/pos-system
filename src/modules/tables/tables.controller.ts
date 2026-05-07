import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TablesService } from './tables.service';
import { CurrentUser } from '../../common/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../../common/auth.types';
import { RequiresPermission, Permission } from '../../common/permissions';

type AreaDto = {
  name: string;
  branchId?: string;
};

type RoomDto = {
  name: string;
  areaId: string;
  branchId?: string;
};

type DiningTableDto = {
  name: string;
  areaId: string;
  roomId?: string | null;
  branchId?: string;
  capacity?: number;
};

@Controller()
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Get('areas')
  listAreas(@CurrentUser() user: CurrentUserType, @Query('branchId') branchId?: string) {
    return this.tablesService.listAreas(user, branchId);
  }

  @Post('areas')
  @RequiresPermission(Permission.TABLES_ACCESS)
  createArea(@CurrentUser() user: CurrentUserType, @Body() dto: AreaDto) {
    return this.tablesService.createArea(user, dto);
  }

  @Patch('areas/:id')
  @RequiresPermission(Permission.TABLES_ACCESS)
  updateArea(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() dto: AreaDto) {
    return this.tablesService.updateArea(user, id, dto);
  }

  @Delete('areas/:id')
  @RequiresPermission(Permission.TABLES_ACCESS)
  deleteArea(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.tablesService.deleteArea(user, id);
  }

  @Get('areas/:id/delete-impact')
  @RequiresPermission(Permission.TABLES_ACCESS)
  getAreaDeleteImpact(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.tablesService.getAreaDeleteImpact(user, id);
  }

  @Get('rooms')
  listRooms(@CurrentUser() user: CurrentUserType, @Query('areaId') areaId?: string, @Query('branchId') branchId?: string) {
    return this.tablesService.listRooms(user, { areaId, branchId });
  }

  @Post('rooms')
  @RequiresPermission(Permission.TABLES_ACCESS)
  createRoom(@CurrentUser() user: CurrentUserType, @Body() dto: RoomDto) {
    return this.tablesService.createRoom(user, dto);
  }

  @Patch('rooms/:id')
  @RequiresPermission(Permission.TABLES_ACCESS)
  updateRoom(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() dto: RoomDto) {
    return this.tablesService.updateRoom(user, id, dto);
  }

  @Delete('rooms/:id')
  @RequiresPermission(Permission.TABLES_ACCESS)
  deleteRoom(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.tablesService.deleteRoom(user, id);
  }

  @Get('rooms/:id/delete-impact')
  @RequiresPermission(Permission.TABLES_ACCESS)
  getRoomDeleteImpact(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.tablesService.getRoomDeleteImpact(user, id);
  }

  @Get('dining-tables')
  listDiningTables(
    @CurrentUser() user: CurrentUserType,
    @Query('branchId') branchId?: string,
    @Query('areaId') areaId?: string,
    @Query('roomId') roomId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.tablesService.listDiningTables(user, {
      branchId,
      areaId,
      roomId,
      search,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 7,
    });
  }

  @Get('dining-tables/options')
  listDiningTableOptions(@CurrentUser() user: CurrentUserType, @Query('branchId') branchId?: string) {
    return this.tablesService.listDiningTableOptions(user, { branchId });
  }

  @Get('dining-tables/:id/delete-impact')
  @RequiresPermission(Permission.TABLES_ACCESS)
  getDiningTableDeleteImpact(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.tablesService.getDiningTableDeleteImpact(user, id);
  }

  @Post('dining-tables')
  @RequiresPermission(Permission.TABLES_ACCESS)
  createDiningTable(@CurrentUser() user: CurrentUserType, @Body() dto: DiningTableDto) {
    return this.tablesService.createDiningTable(user, dto);
  }

  @Patch('dining-tables/:id')
  @RequiresPermission(Permission.TABLES_ACCESS)
  updateDiningTable(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() dto: DiningTableDto) {
    return this.tablesService.updateDiningTable(user, id, dto);
  }

  @Delete('dining-tables/:id')
  @RequiresPermission(Permission.TABLES_ACCESS)
  deleteDiningTable(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.tablesService.deleteDiningTable(user, id);
  }
}
