import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TablesService } from './tables.service';
import { AuthGuard } from '../../common/auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import { UseGuards } from '@nestjs/common';
import type { CurrentUser as CurrentUserType } from '../../common/auth.types';

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
@UseGuards(AuthGuard)
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Get('areas')
  listAreas(@CurrentUser() user: CurrentUserType, @Query('branchId') branchId?: string) {
    return this.tablesService.listAreas(user, branchId);
  }

  @Post('areas')
  createArea(@CurrentUser() user: CurrentUserType, @Body() dto: AreaDto) {
    return this.tablesService.createArea(user, dto);
  }

  @Patch('areas/:id')
  updateArea(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() dto: AreaDto) {
    return this.tablesService.updateArea(user, id, dto);
  }

  @Delete('areas/:id')
  deleteArea(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.tablesService.deleteArea(user, id);
  }

  @Get('rooms')
  listRooms(@CurrentUser() user: CurrentUserType, @Query('areaId') areaId?: string, @Query('branchId') branchId?: string) {
    return this.tablesService.listRooms(user, { areaId, branchId });
  }

  @Post('rooms')
  createRoom(@CurrentUser() user: CurrentUserType, @Body() dto: RoomDto) {
    return this.tablesService.createRoom(user, dto);
  }

  @Patch('rooms/:id')
  updateRoom(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() dto: RoomDto) {
    return this.tablesService.updateRoom(user, id, dto);
  }

  @Delete('rooms/:id')
  deleteRoom(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.tablesService.deleteRoom(user, id);
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

  @Post('dining-tables')
  createDiningTable(@CurrentUser() user: CurrentUserType, @Body() dto: DiningTableDto) {
    return this.tablesService.createDiningTable(user, dto);
  }

  @Patch('dining-tables/:id')
  updateDiningTable(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() dto: DiningTableDto) {
    return this.tablesService.updateDiningTable(user, id, dto);
  }

  @Delete('dining-tables/:id')
  deleteDiningTable(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.tablesService.deleteDiningTable(user, id);
  }
}
