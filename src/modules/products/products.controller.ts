import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Query,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service';

type CreateProductDto = {
  sku?: string;
  name: string;
  categoryId?: string | null;
  unit?: string;
  weight?: number;
  costPrice?: number;
  price: number;
  isActive?: boolean;
  branchConfigs?: { branchId: string; isActive: boolean; stock?: number }[];
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
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get('products')
  listProducts(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('categoryId') categoryId?: string,
    @Query('stockStatus') stockStatus?: 'all' | 'in_stock' | 'out_of_stock',
    @Query('branchId') branchId?: string,
  ) {
    return this.productsService.listProducts({
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
      categoryId: categoryId || undefined,
      stockStatus: stockStatus || 'all',
      branchId: branchId || undefined,
    });
  }

  @Get('products/:id')
  getProductById(@Param('id') id: string) {
    return this.productsService.getProductById(id);
  }

  @Post('products')
  createProduct(@Body() dto: CreateProductDto) {
    return this.productsService.createProduct(dto);
  }

  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body() dto: CreateProductDto) {
    return this.productsService.updateProduct(id, dto);
  }

  @Delete('products/:id')
  deleteProduct(@Param('id') id: string) {
    return this.productsService.deleteProduct(id);
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
