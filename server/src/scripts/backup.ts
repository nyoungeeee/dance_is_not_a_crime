/**
 * SQLite 백업. 실행 중인 DB를 better-sqlite3 backup API로 안전하게 복사하고 integrity_check로 검사한다.
 *   node dist/src/scripts/backup.js           한 번 백업
 *   node dist/src/scripts/backup.js --loop    BACKUP_INTERVAL_HOURS마다 반복(compose backup 서비스)
 * 최근 BACKUP_KEEP개만 남긴다.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = process.env.DATA_DIR || path.resolve(__dirname, '..', '..', '..', '.data');
const source = path.join(dataDir, 'dance.db');
const backupDir = process.env.BACKUP_DIR || path.join(dataDir, 'backups');
const keep = Number(process.env.BACKUP_KEEP || 28);
const hours = Number(process.env.BACKUP_INTERVAL_HOURS || 3);

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  const k = new Date(d.getTime() + 9 * 3600 * 1000); // 파일 이름은 한국 시간
  return `${k.getUTCFullYear()}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}-${p(k.getUTCHours())}${p(k.getUTCMinutes())}`;
}

export async function backupOnce(): Promise<string | null> {
  if (!fs.existsSync(source)) {
    console.warn(`백업 건너뜀: ${source} 없음`);
    return null;
  }
  fs.mkdirSync(backupDir, { recursive: true });
  const dest = path.join(backupDir, `dance-${stamp()}.db`);
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
  const check = new Database(dest, { readonly: true });
  const result = check.pragma('integrity_check', { simple: true });
  check.close();
  if (result !== 'ok') throw new Error(`백업 검사 실패(${dest}): ${result}`);
  const old = fs.readdirSync(backupDir).filter((f) => /^dance-\d{8}-\d{4}\.db$/.test(f)).sort().reverse().slice(keep);
  for (const f of old) fs.rmSync(path.join(backupDir, f));
  console.log(`백업 완료: ${dest}`);
  return dest;
}

if (require.main === module) {
  const run = () => backupOnce().catch((e) => console.error(e));
  if (process.argv.includes('--loop')) {
    run();
    setInterval(run, hours * 3600 * 1000);
  } else {
    backupOnce().catch((e) => {
      console.error(e);
      process.exit(1);
    });
  }
}
