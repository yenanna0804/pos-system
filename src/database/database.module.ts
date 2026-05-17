import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';
import { PgService } from './pg.service';
import { SqliteService } from './sqlite.service';

@Global()
@Module({
  providers: [
    PgService,
    SqliteService,
    {
      provide: DbService,
      useFactory: (pgService: PgService, sqliteService: SqliteService) => {
        const dialect = process.env.DB_DIALECT ?? 'postgres';
        return dialect === 'sqlite' ? sqliteService : pgService;
      },
      inject: [PgService, SqliteService],
    },
  ],
  exports: [DbService],
})
export class DatabaseModule {}
