import path from 'node:path';
import { defineConfig } from 'prisma/config';

// 앱(src/config.ts)과 같은 규칙: DATA_DIR/dance.db. DATABASE_URL을 주면 그쪽이 우선.
const dataDir = process.env.DATA_DIR || path.join(__dirname, '.data');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL || `file:${path.join(dataDir, 'dance.db')}` },
});
