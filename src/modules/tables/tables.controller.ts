import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TablesService } from './tables.service';

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
  listAreas(@Query('branchId') branchId?: string) {
    return this.tablesService.listAreas(branchId);
  }

  @Post('areas')
  createArea(@Body() dto: AreaDto) {
    return this.tablesService.createArea(dto);
  }

  @Patch('areas/:id')
  updateArea(@Param('id') id: string, @Body() dto: AreaDto) {
    return this.tablesService.updateArea(id, dto);
  }

  @Delete('areas/:id')
  deleteArea(@Param('id') id: string) {
    return this.tablesService.deleteArea(id);
  }

  @Get('rooms')
  listRooms(@Query('areaId') areaId?: string, @Query('branchId') branchId?: string) {
    return this.tablesService.listRooms({ areaId, branchId });
  }

  @Post('rooms')
  createRoom(@Body() dto: RoomDto) {
    return this.tablesService.createRoom(dto);
  }

  @Patch('rooms/:id')
  updateRoom(@Param('id') id: string, @Body() dto: RoomDto) {
    return this.tablesService.updateRoom(id, dto);
  }

  @Delete('rooms/:id')
  deleteRoom(@Param('id') id: string) {
    return this.tablesService.deleteRoom(id);
  }

  @Get('dining-tables')
  listDiningTables(
    @Query('branchId') branchId?: string,
    @Query('areaId') areaId?: string,
    @Query('roomId') roomId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.tablesService.listDiningTables({
      branchId,
      areaId,
      roomId,
      search,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 7,
    });
  }

  @Get('dining-tables/options')
  listDiningTableOptions(@Query('branchId') branchId?: string) {
    return this.tablesService.listDiningTableOptions({ branchId });
  }

  @Post('dining-tables')
  createDiningTable(@Body() dto: DiningTableDto) {
    return this.tablesService.createDiningTable(dto);
  }

  @Patch('dining-tables/:id')
  updateDiningTable(@Param('id') id: string, @Body() dto: DiningTableDto) {
    return this.tablesService.updateDiningTable(id, dto);
  }

  @Delete('dining-tables/:id')
  deleteDiningTable(@Param('id') id: string) {
    return this.tablesService.deleteDiningTable(id);
  }
}
