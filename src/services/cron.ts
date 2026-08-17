import { getSettings, listReservations, deleteReservation } from '../data/repository.js';
import { addLog } from '../data/adminRepository.js';
import { hasDatabase, sql } from '../db/client.js';

export const runArchiveRetentionCleanup = async (): Promise<number> => {
  try {
    const settings = await getSettings();
    const retentionDays = Number(settings.archiveRetentionDays) || 365;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const y = cutoff.getFullYear();
    const m = String(cutoff.getMonth() + 1).padStart(2, '0');
    const d = String(cutoff.getDate()).padStart(2, '0');
    const cutoffDateStr = `${y}-${m}-${d}`;

    let deletedCount = 0;

    if (hasDatabase && sql) {
      const rows = (await sql`
        DELETE FROM reservations
        WHERE date < ${cutoffDateStr}::date
        RETURNING id
      `) as { id: string }[];
      deletedCount = rows.length;

      // Also clean up expired 2FA verification tokens
      await sql`
        DELETE FROM reservation_verifications
        WHERE expires_at < now()
      `;
    } else {
      const all = await listReservations();
      const expired = all.filter((r) => r.date < cutoffDateStr);
      for (const r of expired) {
        await deleteReservation(r.id);
        deletedCount += 1;
      }
    }

    if (deletedCount > 0) {
      await addLog(`cron.archive_cleanup:${deletedCount}_records_older_than_${retentionDays}d`, 'system');
      console.log(`[CRON] Archive retention cleanup purged ${deletedCount} reservations older than ${retentionDays} days (before ${cutoffDateStr}).`);
    }

    return deletedCount;
  } catch (error) {
    console.error('[CRON] Error running archive retention cleanup:', error);
    return 0;
  }
};

let cronInterval: NodeJS.Timeout | null = null;

export const startCronJobs = () => {
  if (cronInterval) return;

  // Run on startup
  runArchiveRetentionCleanup().catch((err) => console.error('[CRON] Startup cleanup error:', err));

  // Run every 6 hours (21600000 ms)
  cronInterval = setInterval(() => {
    runArchiveRetentionCleanup().catch((err) => console.error('[CRON] Periodic cleanup error:', err));
  }, 6 * 60 * 60 * 1000);

  // Allow process to exit cleanly without waiting on interval
  if (cronInterval.unref) {
    cronInterval.unref();
  }
};
