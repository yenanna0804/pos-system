import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  UseGuards,
  Query,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service';
import { AuthGuard } from '../../common/auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../../common/auth.types';

type CreateProductDto = {
  type?: 'SINGLE' | 'COMBO';
  autoPrice?: boolean;
  sku?: string;
  name: string;
  categoryId?: string | null;
  unit?: string;
  weight?: number;
  costPrice?: number;
  price: number;
  isActive?: boolean;
  branchConfigs?: { branchId: string; isActive: boolean; stock?: number }[];
  comboItems?: { itemProductId: string; quantity: number; itemName?: string; itemUnit?: string }[];
  imageUrl?: string | null;
  imageThumb?: string | null;
};

type CreateCategoryDto = {
  name: string;
};

type UpdateCategoryDto = {
  name: string;
};

@Controller()
@UseGuards(AuthGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get('products')
  listProducts(
    @CurrentUser() user: CurrentUserType,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('type') type?: 'SINGLE' | 'COMBO',
    @Query('categoryId') categoryId?: string,
    @Query('stockStatus') stockStatus?: 'all' | 'in_stock' | 'out_of_stock',
    @Query('branchId') branchId?: string,
    @Query('search') search?: string,
  ) {
    return this.productsService.listProducts({
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
      type: type || undefined,
      categoryId: categoryId || undefined,
      stockStatus: stockStatus || 'all',
      branchId: branchId || undefined,
      search: search || undefined,
    }, user);
  }

  @Get('products/:id')
  getProductById(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.productsService.getProductById(id, user);
  }

  @Post('products')
  createProduct(@CurrentUser() user: CurrentUserType, @Body() dto: CreateProductDto) {
    return this.productsService.createProduct(dto, user);
  }

  @Patch('products/:id')
  updateProduct(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() dto: CreateProductDto) {
    return this.productsService.updateProduct(id, dto, user);
  }

  @Delete('products/:id')
  deleteProduct(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.productsService.deleteProduct(id, user);
  }

  @Post('products/upload-image')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn hình ảnh');
    }
    return this.productsService.processAndSaveImage(file);
  }

  @Get('categories')
  listCategories() {
    return this.productsService.listCategories();
  }

  @Post('categories')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.productsService.createCategory(dto.name);
  }

  @Patch('categories/:id')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.productsService.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.productsService.deleteCategory(id);
  }
}
