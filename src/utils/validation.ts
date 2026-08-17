import type { TableResource, Reservation } from '../data/mockData.js';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export const WEEKDAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function parseMinutes(time: string): number | null {
  if (!time || typeof time !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h < 0 || h > 24 || m < 0 || m > 59) return null;
  if (h === 24 && m !== 0) return null;
  return h * 60 + m;
}

export function weekdayKeyFor(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return WEEKDAY_KEYS[date.getDay()];
}

export function getOpeningHoursForDate(settings: any, dateStr: string): { open: string; close: string } | null {
  const overrides = Array.isArray(settings?.specialHours) ? settings.specialHours : [];
  const override = overrides.find((entry: any) => entry.date === dateStr);
  if (override) {
    if (override.closed) return null;
    return { open: override.open, close: override.close };
  }
  const weekly = settings?.openingHours?.[weekdayKeyFor(dateStr)];
  if (!weekly || !weekly.open || !weekly.close) return null;
  return weekly;
}

export function validateReservationPayload(params: {
  resource: TableResource;
  settings: any;
  allReservations: Reservation[];
  date: string;
  startTime: string;
  endTime: string;
  guestCount: number;
  existingReservationId?: string;
  isStaff?: boolean;
}): ValidationResult {
  const { resource, settings, allReservations, date, startTime, endTime, guestCount, existingReservationId, isStaff } = params;

  // 1. Table status check
  if (resource.status === 'disabled') {
    return { valid: false, error: `Stůl "${resource.name}" je v současné době deaktivován.` };
  }

  // 2. Guest count & capacity checks
  if (typeof guestCount !== 'number' || isNaN(guestCount) || guestCount < 1) {
    return { valid: false, error: 'Počet hostů musí být celé číslo větší než 0.' };
  }
  if (guestCount < resource.minGuests) {
    return { valid: false, error: `Tento stůl vyžaduje minimálně ${resource.minGuests} osob (zadáno: ${guestCount}).` };
  }
  if (guestCount > resource.maxGuests) {
    return { valid: false, error: `Tento stůl má maximální kapacitu ${resource.maxGuests} osob (zadáno: ${guestCount}).` };
  }

  // 3. Date format and past-date checks
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { valid: false, error: 'Datum musí být ve formátu RRRR-MM-DD.' };
  }

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;

  if (date < todayStr) {
    return { valid: false, error: 'Nelze vytvořit rezervaci v minulosti.' };
  }

  // 4. Time format and sequence
  const startMinutes = parseMinutes(startTime);
  const endMinutes = parseMinutes(endTime);

  if (startMinutes === null || endMinutes === null) {
    return { valid: false, error: 'Čas začátku a konce musí být v platném formátu HH:MM.' };
  }

  if (startMinutes >= endMinutes) {
    return { valid: false, error: 'Čas začátku rezervace musí být dříve než čas konce.' };
  }

  // 5. Schedule steps alignment
  const slotMinutes = Number(settings?.slotMinutes) || 30;
  if (startMinutes % slotMinutes !== 0 || endMinutes % slotMinutes !== 0) {
    return { valid: false, error: `Časy rezervace musí odpovídat rezervačním slotům po ${slotMinutes} minutách.` };
  }

  // 6. Duration limits
  const duration = endMinutes - startMinutes;
  const minDuration = Number(settings?.minimumReservationMinutes) || 60;
  const maxDuration = Number(settings?.maximumReservationMinutes) || 180;

  if (duration < minDuration) {
    return { valid: false, error: `Minimální délka rezervace je ${minDuration} minut.` };
  }
  if (duration > maxDuration) {
    return { valid: false, error: `Maximální délka rezervace je ${maxDuration} minut.` };
  }

  // 7. Opening hours check
  const hours = getOpeningHoursForDate(settings, date);
  if (!hours) {
    return { valid: false, error: `V daný den (${date}) má restaurace zavřeno.` };
  }

  const openMinutes = parseMinutes(hours.open);
  const closeMinutes = parseMinutes(hours.close);

  if (openMinutes === null || closeMinutes === null) {
    return { valid: false, error: 'Otevírací doba není správně nastavena.' };
  }

  if (startMinutes < openMinutes || endMinutes > closeMinutes) {
    return { valid: false, error: `Rezervace musí být v rámci otevírací doby (${hours.open}–${hours.close}).` };
  }

  // 8. Lead time check (for guests)
  if (!isStaff && date === todayStr) {
    const leadMinutes = Number(settings?.minimumLeadMinutes) || 0;
    const currentDayMinutes = now.getHours() * 60 + now.getMinutes();
    if (startMinutes < currentDayMinutes + leadMinutes) {
      return { valid: false, error: `Rezervaci je nutné vytvořit alespoň ${leadMinutes} minut předem.` };
    }
  }

  // 9. Collision check with other active reservations on the same table
  const cleanupMinutes = Number(settings?.cleanupMinutes) || 0;
  const activeReservations = allReservations.filter((r) => {
    if (r.id === existingReservationId) return false;
    if (r.resourceId !== resource.id || r.date !== date) return false;
    if (r.status === 'cancelled' || r.status === 'no_show' || r.status === 'archived') return false;
    return true;
  });

  for (const r of activeReservations) {
    const rStart = parseMinutes(r.startTime);
    const rEnd = parseMinutes(r.endTime);
    if (rStart === null || rEnd === null) continue;

    const hasOverlap = startMinutes < (rEnd + cleanupMinutes) && (endMinutes + cleanupMinutes) > rStart;
    if (hasOverlap) {
      return {
        valid: false,
        error: `Stůl "${resource.name}" je v čase ${r.startTime}–${r.endTime} již rezervován (včetně doby úklidu ${cleanupMinutes} min).`
      };
    }
  }

  return { valid: true };
}
