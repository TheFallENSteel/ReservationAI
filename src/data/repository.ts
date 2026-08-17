import { hasDatabase, sql } from '../db/client.js';
import {
  reservations as memoryReservations,
  resources as memoryResources,
  settings as memorySettings,
  type Reservation,
  type TableResource
} from './mockData.js';

type ResourceRow = {
  id: string;
  name: string;
  capacity: number;
  zone: string;
  status: TableResource['status'];
  min_guests: number;
  max_guests: number;
};

type ReservationRow = {
  id: string;
  resource_id: string;
  guest_name: string;
  email: string;
  phone: string;
  guest_count: number;
  date: string | Date;
  start_time: string;
  end_time: string;
  status: Reservation['status'];
  notes: string | null;
  block_id: string | null;
};

// The Neon driver returns SQL DATE columns as JS Date objects; normalize to a
// plain YYYY-MM-DD string using local date parts (matches how the date was inserted).
export const toDateOnlyString = (value: string | Date): string => {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
};

const toResource = (row: ResourceRow): TableResource => ({
  id: row.id,
  name: row.name,
  capacity: row.capacity,
  zone: row.zone,
  status: row.status,
  minGuests: row.min_guests,
  maxGuests: row.max_guests
});

const toReservation = (row: ReservationRow): Reservation => ({
  id: row.id,
  resourceId: row.resource_id,
  guestName: row.guest_name,
  email: row.email,
  phone: row.phone,
  guestCount: row.guest_count,
  date: toDateOnlyString(row.date),
  startTime: row.start_time,
  endTime: row.end_time,
  status: row.status,
  notes: row.notes ?? undefined,
  blockId: row.block_id ?? undefined
});

const computeDynamicResourceStatus = (resource: TableResource, allReservations: Reservation[]): TableResource => {
  if (resource.status === 'disabled') return resource;
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const today = `${y}-${m}-${d}`;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const isOccupied = allReservations.some((r) => {
    if (r.resourceId !== resource.id) return false;
    if (r.status === 'cancelled' || r.status === 'no_show' || r.status === 'archived') return false;
    // If a guest is currently checked in (přítomen), the table is physically occupied right now
    if (r.status === 'checked_in') return true;
    if (r.date === today) {
      if (['confirmed', 'completed', 'pending'].includes(r.status)) {
        const [sh, sm] = r.startTime.split(':').map(Number);
        const [eh, em] = r.endTime.split(':').map(Number);
        const sMin = (sh ?? 0) * 60 + (sm ?? 0);
        const eMin = (eh ?? 0) * 60 + (em ?? 0);
        return sMin <= nowMinutes && nowMinutes <= eMin;
      }
    }
    return false;
  });

  return {
    ...resource,
    status: isOccupied ? 'occupied' : 'available'
  };
};

export const listResources = async (): Promise<TableResource[]> => {
  const allReservations = await listReservations();
  if (hasDatabase && sql) {
    const rows = (await sql`SELECT * FROM resources ORDER BY id`) as ResourceRow[];
    return rows.map(toResource).map((r) => computeDynamicResourceStatus(r, allReservations));
  }
  return memoryResources.map((r) => computeDynamicResourceStatus(r, allReservations));
};

export const getResource = async (resourceId: string): Promise<TableResource | undefined> => {
  const allReservations = await listReservations();
  if (hasDatabase && sql) {
    const rows = (await sql`SELECT * FROM resources WHERE id = ${resourceId}`) as ResourceRow[];
    return rows[0] ? computeDynamicResourceStatus(toResource(rows[0]), allReservations) : undefined;
  }
  const found = memoryResources.find((resource) => resource.id === resourceId);
  return found ? computeDynamicResourceStatus(found, allReservations) : undefined;
};

export const createResource = async (input: TableResource): Promise<TableResource> => {
  if (hasDatabase && sql) {
    const rows = (await sql`
      INSERT INTO resources (id, name, capacity, zone, status, min_guests, max_guests)
      VALUES (${input.id}, ${input.name}, ${input.capacity}, ${input.zone}, ${input.status}, ${input.minGuests}, ${input.maxGuests})
      RETURNING *
    `) as ResourceRow[];
    return toResource(rows[0]);
  }
  memoryResources.push(input);
  return input;
};

export const updateResource = async (
  resourceId: string,
  changes: Partial<TableResource>
): Promise<TableResource | undefined> => {
  if (hasDatabase && sql) {
    const existing = await getResource(resourceId);
    if (!existing) return undefined;
    const merged = { ...existing, ...changes, id: resourceId };
    const rows = (await sql`
      UPDATE resources
      SET name = ${merged.name}, capacity = ${merged.capacity}, zone = ${merged.zone},
          status = ${merged.status}, min_guests = ${merged.minGuests}, max_guests = ${merged.maxGuests}
      WHERE id = ${resourceId}
      RETURNING *
    `) as ResourceRow[];
    return rows[0] ? toResource(rows[0]) : undefined;
  }
  const index = memoryResources.findIndex((resource) => resource.id === resourceId);
  if (index === -1) return undefined;
  memoryResources[index] = { ...memoryResources[index], ...changes, id: resourceId };
  return memoryResources[index];
};

export const deleteResource = async (resourceId: string): Promise<boolean> => {
  if (hasDatabase && sql) {
    const rows = (await sql`DELETE FROM resources WHERE id = ${resourceId} RETURNING id`) as { id: string }[];
    return rows.length > 0;
  }
  const index = memoryResources.findIndex((resource) => resource.id === resourceId);
  if (index === -1) return false;
  memoryResources.splice(index, 1);
  return true;
};

export const listReservations = async (filter?: { resourceId?: string }): Promise<Reservation[]> => {
  if (hasDatabase && sql) {
    const rows = (filter?.resourceId
      ? await sql`SELECT * FROM reservations WHERE resource_id = ${filter.resourceId} ORDER BY date, start_time`
      : await sql`SELECT * FROM reservations ORDER BY date, start_time`) as ReservationRow[];
    return rows.map(toReservation);
  }
  return filter?.resourceId
    ? memoryReservations.filter((reservation) => reservation.resourceId === filter.resourceId)
    : memoryReservations;
};

export const getReservationsByIds = async (ids: string[]): Promise<Reservation[]> => {
  if (ids.length === 0) return [];
  if (hasDatabase && sql) {
    const rows = (await sql`SELECT * FROM reservations WHERE id = ANY(${ids})`) as ReservationRow[];
    return rows.map(toReservation);
  }
  return memoryReservations.filter((reservation) => ids.includes(reservation.id));
};

export const getReservation = async (reservationId: string): Promise<Reservation | undefined> => {
  if (hasDatabase && sql) {
    const rows = (await sql`SELECT * FROM reservations WHERE id = ${reservationId}`) as ReservationRow[];
    return rows[0] ? toReservation(rows[0]) : undefined;
  }
  return memoryReservations.find((reservation) => reservation.id === reservationId);
};

export const createReservation = async (input: Reservation): Promise<Reservation> => {
  if (hasDatabase && sql) {
    const rows = (await sql`
      INSERT INTO reservations (id, resource_id, guest_name, email, phone, guest_count, date, start_time, end_time, status, notes, block_id)
      VALUES (${input.id}, ${input.resourceId}, ${input.guestName}, ${input.email}, ${input.phone}, ${input.guestCount}, ${input.date}, ${input.startTime}, ${input.endTime}, ${input.status}, ${input.notes ?? null}, ${input.blockId ?? null})
      RETURNING *
    `) as ReservationRow[];
    return toReservation(rows[0]);
  }
  memoryReservations.push(input);
  return input;
};

export const updateReservation = async (
  reservationId: string,
  changes: Partial<Reservation>
): Promise<Reservation | undefined> => {
  if (hasDatabase && sql) {
    const existing = await getReservation(reservationId);
    if (!existing) return undefined;
    const merged = { ...existing, ...changes, id: reservationId };
    const rows = (await sql`
      UPDATE reservations
      SET resource_id = ${merged.resourceId}, guest_name = ${merged.guestName}, email = ${merged.email},
          phone = ${merged.phone}, guest_count = ${merged.guestCount}, date = ${merged.date},
          start_time = ${merged.startTime}, end_time = ${merged.endTime}, status = ${merged.status},
          notes = ${merged.notes ?? null}, block_id = ${merged.blockId ?? null}
      WHERE id = ${reservationId}
      RETURNING *
    `) as ReservationRow[];
    return rows[0] ? toReservation(rows[0]) : undefined;
  }
  const index = memoryReservations.findIndex((reservation) => reservation.id === reservationId);
  if (index === -1) return undefined;
  memoryReservations[index] = { ...memoryReservations[index], ...changes, id: reservationId };
  return memoryReservations[index];
};

export const deleteReservation = async (reservationId: string): Promise<Reservation | undefined> => {
  if (hasDatabase && sql) {
    const rows = (await sql`DELETE FROM reservations WHERE id = ${reservationId} RETURNING *`) as ReservationRow[];
    return rows[0] ? toReservation(rows[0]) : undefined;
  }
  const index = memoryReservations.findIndex((reservation) => reservation.id === reservationId);
  if (index === -1) return undefined;
  const [removed] = memoryReservations.splice(index, 1);
  return removed;
};

export const getSettings = async (): Promise<typeof memorySettings> => {
  if (hasDatabase && sql) {
    const rows = (await sql`SELECT value FROM settings WHERE key = 'default'`) as { value: typeof memorySettings }[];
    return rows[0]?.value ? { ...memorySettings, ...rows[0].value } : memorySettings;
  }
  return memorySettings;
};

export const updateSetting = async (name: string, value: unknown): Promise<typeof memorySettings> => {
  if (hasDatabase && sql) {
    const current = await getSettings();
    const merged = { ...current, [name]: value };
    await sql`
      UPDATE settings SET value = ${JSON.stringify(merged)}::jsonb WHERE key = 'default'
    `;
    return merged;
  }
  (memorySettings as Record<string, unknown>)[name] = value;
  return memorySettings;
};
