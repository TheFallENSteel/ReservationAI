import { createHash, randomBytes } from 'node:crypto';

// Session/reset tokens are high-entropy random strings; only their SHA-256 hash is persisted,
// so a database leak alone can't be replayed as a valid token.
export const generateToken = (): string => randomBytes(32).toString('hex');

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
