import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';
import { DbService } from './database/db.service';
import { assertOrdersAdjustmentSchema } from './database/schema-guard';
import { seed } from './database/seed';

async function bootstrap() {
  await assertOrdersAdjustmentSchema();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors();
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ extended: true, limit: '5mb' }));
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  const db = app.get(DbService);
  await seed(db);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
