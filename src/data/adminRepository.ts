import { randomUUID } from 'node:crypto';

import { hasDatabase, sql } from '../db/client.js';
import { listReservations } from './repository.js';
import {
  auditLogs as memoryLogs,
  tableBlocks as memoryTableBlocks,
  zones as memoryZones,
  type AuditLog,
  type TableBlock,
  type Zone
} from './mockData.js';

type ZoneRow = { id: string; name: string };

type TableBlockRow = {
  id: string;
  label: string;
  table_ids: string[];
  date: string;
  start_time: string;
  end_time: string;
};

type AuditLogRow = { id: string; action: string; actor: string; timestamp: string };

const toTableBlock = (row: TableBlockRow): TableBlock => ({
  id: row.id,
  label: row.label,
  tableIds: row.table_ids,
  date: row.date,
  startTime: row.start_time,
  endTime: row.end_time
});

export const listZones = async (): Promise<Zone[]> => {
  if (hasDatabase && sql) {
    return (await sql`SELECT * FROM zones ORDER BY id`) as ZoneRow[];
  }
  return memoryZones;
};

export const createZone = async (input: Zone): Promise<Zone> => {
  if (hasDatabase && sql) {
    const rows = (await sql`INSERT INTO zones (id, name) VALUES (${input.id}, ${input.name}) RETURNING *`) as ZoneRow[];
    return rows[0];
  }
  memoryZones.push(input);
  return input;
};

export const updateZone = async (zoneId: string, changes: Partial<Zone>): Promise<Zone | undefined> => {
  if (hasDatabase && sql) {
    const rows = (await sql`
      UPDATE zones SET name = COALESCE(${changes.name ?? null}, name) WHERE id = ${zoneId} RETURNING *
    `) as ZoneRow[];
    return rows[0];
  }
  const zone = memoryZones.find((entry) => entry.id === zoneId);
  if (!zone) return undefined;
  Object.assign(zone, changes, { id: zoneId });
  return zone;
};

export const deleteZone = async (zoneId: string): Promise<boolean> => {
  if (hasDatabase && sql) {
    const rows = (await sql`DELETE FROM zones WHERE id = ${zoneId} RETURNING id`) as { id: string }[];
    return rows.length > 0;
  }
  const index = memoryZones.findIndex((entry) => entry.id === zoneId);
  if (index === -1) return false;
  memoryZones.splice(index, 1);
  return true;
};

export const listTableBlocks = async (): Promise<TableBlock[]> => {
  if (hasDatabase && sql) {
    const rows = (await sql`SELECT * FROM table_blocks ORDER BY date, start_time`) as TableBlockRow[];
    return rows.map(toTableBlock);
  }
  return memoryTableBlocks;
};

export const createTableBlock = async (input: TableBlock): Promise<TableBlock> => {
  if (hasDatabase && sql) {
    const rows = (await sql`
      INSERT INTO table_blocks (id, label, table_ids, date, start_time, end_time)
      VALUES (${input.id}, ${input.label}, ${input.tableIds}, ${input.date}, ${input.startTime}, ${input.endTime})
      RETURNING *
    `) as TableBlockRow[];
    return toTableBlock(rows[0]);
  }
  memoryTableBlocks.push(input);
  return input;
};

export const deleteTableBlock = async (blockId: string): Promise<boolean> => {
  if (hasDatabase && sql) {
    const rows = (await sql`DELETE FROM table_blocks WHERE id = ${blockId} RETURNING id`) as { id: string }[];
    return rows.length > 0;
  }
  const index = memoryTableBlocks.findIndex((entry) => entry.id === blockId);
  if (index === -1) return false;
  memoryTableBlocks.splice(index, 1);
  return true;
};

export const addLog = async (action: string, actor: string): Promise<AuditLog> => {
  const entry: AuditLog = { id: `log-${randomUUID()}`, action, actor, timestamp: new Date().toISOString() };

  if (hasDatabase && sql) {
    await sql`INSERT INTO logs (id, action, actor, timestamp) VALUES (${entry.id}, ${entry.action}, ${entry.actor}, ${entry.timestamp})`;
    return entry;
  }

  memoryLogs.push(entry);
  return entry;
};

export const listLogs = async (): Promise<AuditLog[]> => {
  if (hasDatabase && sql) {
    const rows = (await sql`SELECT * FROM logs ORDER BY timestamp DESC`) as AuditLogRow[];
    return rows;
  }
  return [...memoryLogs].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
};

export const getReservationStats = async () => {
  const all = await listReservations();

  const totalReservations = all.length;
  const confirmed = all.filter((r) => ['confirmed', 'checked_in', 'completed'].includes(r.status)).length;
  const cancelled = all.filter((r) => r.status === 'cancelled').length;
  const noShow = all.filter((r) => r.status === 'no_show').length;

  const byDayMap = new Map<string, number>();
  for (const reservation of all) {
    byDayMap.set(reservation.date, (byDayMap.get(reservation.date) ?? 0) + 1);
  }
  const byDay = [...byDayMap.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { totalReservations, confirmed, cancelled, noShow, byDay };
};
