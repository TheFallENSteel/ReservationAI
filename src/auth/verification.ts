import { randomUUID } from 'node:crypto';
import { hasDatabase, sql } from '../db/client.js';
import {
  reservationVerifications as memoryVerifications,
  type ReservationVerification
} from '../data/mockData.js';

type VerificationRow = {
  reservation_id: string;
  code: string;
  token: string;
  expires_at: string;
};

const VERIFICATION_TTL_MS = 15 * 60 * 1000; // 15 minutes

const isExpired = (expiresAt: string | Date): boolean => {
  const expiryTime = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  return expiryTime <= Date.now();
};

export const createReservationVerification = async (
  reservationId: string
): Promise<{ code: string; token: string }> => {
  // Generate 6-digit numeric code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const token = `tok-${randomUUID()}`;
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS).toISOString();

  if (hasDatabase && sql) {
    await sql`
      CREATE TABLE IF NOT EXISTS reservation_verifications (
        reservation_id TEXT PRIMARY KEY REFERENCES reservations(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      )
    `;

    await sql`
      INSERT INTO reservation_verifications (reservation_id, code, token, expires_at)
      VALUES (${reservationId}, ${code}, ${token}, ${expiresAt})
      ON CONFLICT (reservation_id)
      DO UPDATE SET code = EXCLUDED.code, token = EXCLUDED.token, expires_at = EXCLUDED.expires_at
    `;
  } else {
    const existingIndex = memoryVerifications.findIndex((v) => v.reservationId === reservationId);
    const entry: ReservationVerification = { reservationId, code, token, expiresAt };
    if (existingIndex !== -1) {
      memoryVerifications[existingIndex] = entry;
    } else {
      memoryVerifications.push(entry);
    }
  }

  return { code, token };
};

export const verifyReservationCode = async (
  reservationId: string,
  code: string
): Promise<boolean> => {
  if (hasDatabase && sql) {
    await sql`
      CREATE TABLE IF NOT EXISTS reservation_verifications (
        reservation_id TEXT PRIMARY KEY REFERENCES reservations(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      )
    `;

    const rows = (await sql`
      SELECT * FROM reservation_verifications WHERE reservation_id = ${reservationId}
    `) as VerificationRow[];
    const record = rows[0];
    if (!record) return false;

    if (isExpired(record.expires_at)) {
      await sql`DELETE FROM reservation_verifications WHERE reservation_id = ${reservationId}`;
      return false;
    }

    if (record.code.trim() === code.trim()) {
      await sql`DELETE FROM reservation_verifications WHERE reservation_id = ${reservationId}`;
      return true;
    }

    return false;
  }

  const index = memoryVerifications.findIndex((v) => v.reservationId === reservationId);
  if (index === -1) return false;
  const record = memoryVerifications[index];

  if (isExpired(record.expiresAt)) {
    memoryVerifications.splice(index, 1);
    return false;
  }

  if (record.code.trim() === code.trim()) {
    memoryVerifications.splice(index, 1);
    return true;
  }

  return false;
};

export const verifyReservationToken = async (
  token: string
): Promise<string | null> => {
  if (hasDatabase && sql) {
    await sql`
      CREATE TABLE IF NOT EXISTS reservation_verifications (
        reservation_id TEXT PRIMARY KEY REFERENCES reservations(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      )
    `;

    const rows = (await sql`
      SELECT * FROM reservation_verifications WHERE token = ${token}
    `) as VerificationRow[];
    const record = rows[0];
    if (!record) return null;

    if (isExpired(record.expires_at)) {
      await sql`DELETE FROM reservation_verifications WHERE reservation_id = ${record.reservation_id}`;
      return null;
    }

    await sql`DELETE FROM reservation_verifications WHERE reservation_id = ${record.reservation_id}`;
    return record.reservation_id;
  }

  const index = memoryVerifications.findIndex((v) => v.token === token);
  if (index === -1) return null;
  const record = memoryVerifications[index];

  if (isExpired(record.expiresAt)) {
    memoryVerifications.splice(index, 1);
    return null;
  }

  memoryVerifications.splice(index, 1);
  return record.reservationId;
};
