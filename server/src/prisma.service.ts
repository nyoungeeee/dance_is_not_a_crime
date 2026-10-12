import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import fs from 'node:fs';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from './generated/prisma/client';
import { AppConfig, CONFIG } from './config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(CONFIG) cfg: AppConfig) {
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    super({ adapter: new PrismaBetterSqlite3({ url: cfg.databaseUrl }) });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
