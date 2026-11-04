import { migrateReceiptEventTime } from '../content-safety-migration.mjs';
import { copySqliteFixture, quiescence, safetyFixture } from './content-safety-s2h-fixture.mjs';
export { ns, ok, receipt } from './content-safety-s2h-fixture.mjs';

export async function migrateEventTime(f) {
  copySqliteFixture(f.path, f.backupPath);
  return migrateReceiptEventTime({ path: f.path, backupPath: f.backupPath,
    expected: { storeId: f.storeId, base: f.base }, quiescence });
}
export async function eventTimeFixture(t, base = 18) {
  const f = safetyFixture(t, base);
  await migrateEventTime(f);
  return f;
}

export function eventTimeSafetyFixture(t, base = 18) {
  const f = safetyFixture(t, base);
  return { ...f, migrate: () => migrateEventTime(f) };
}
