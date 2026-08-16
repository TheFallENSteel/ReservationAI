import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

// Format: "<salt-hex>:<hash-hex>" so verification is self-contained (no separate salt column needed).
export const hashSecret = (secret: string): string => {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(secret, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;
};

export const verifySecret = (secret: string, stored: string | undefined): boolean => {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;

  const candidate = scryptSync(secret, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
};
