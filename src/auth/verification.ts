import { randomUUID } from 'node:crypto';

interface Pending2FA {
  reservationId: string;
  code: string;
  token: string;
  expiresAt: number;
}

const pendingStore = new Map<string, Pending2FA>();
const tokenIndex = new Map<string, string>(); // token -> reservationId

export const createReservationVerification = (reservationId: string): { code: string; token: string } => {
  // Generate 6-digit numeric code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const token = `tok-${randomUUID()}`;
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes TTL

  pendingStore.set(reservationId, { reservationId, code, token, expiresAt });
  tokenIndex.set(token, reservationId);

  return { code, token };
};

export const verifyReservationCode = (reservationId: string, code: string): boolean => {
  const record = pendingStore.get(reservationId);
  if (!record) return false;
  if (Date.now() > record.expiresAt) {
    pendingStore.delete(reservationId);
    tokenIndex.delete(record.token);
    return false;
  }

  if (record.code.trim() === code.trim()) {
    pendingStore.delete(reservationId);
    tokenIndex.delete(record.token);
    return true;
  }

  return false;
};

export const verifyReservationToken = (token: string): string | null => {
  const reservationId = tokenIndex.get(token);
  if (!reservationId) return null;

  const record = pendingStore.get(reservationId);
  if (!record || Date.now() > record.expiresAt) {
    tokenIndex.delete(token);
    if (record) pendingStore.delete(reservationId);
    return null;
  }

  pendingStore.delete(reservationId);
  tokenIndex.delete(token);
  return reservationId;
};
