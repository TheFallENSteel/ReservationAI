import { hasDatabase, sql } from '../db/client.js';
import { generateToken, hashToken } from '../auth/tokens.js';
import {
  passwordResetTokens as memoryResetTokens,
  sessions as memorySessions,
  staffUsers as memoryStaffUsers,
  type Session,
  type StaffRole,
  type StaffUser
} from './mockData.js';

type StaffUserRow = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  password_hash: string;
  pin_hash: string | null;
};

type SessionRow = {
  token: string;
  user_id: string;
  expires_at: string;
};

type ResetTokenRow = {
  token_hash: string;
  user_id: string;
  expires_at: string;
};

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

const toStaffUser = (row: StaffUserRow): StaffUser => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role,
  passwordHash: row.password_hash,
  pinHash: row.pin_hash ?? undefined
});

const isExpired = (expiresAt: string): boolean => new Date(expiresAt).getTime() <= Date.now();

export const listStaffUsers = async (): Promise<StaffUser[]> => {
  if (hasDatabase && sql) {
    const rows = (await sql`SELECT * FROM staff_users ORDER BY id`) as StaffUserRow[];
    return rows.map(toStaffUser);
  }
  return memoryStaffUsers;
};

export const findStaffById = async (userId: string): Promise<StaffUser | undefined> => {
  if (hasDatabase && sql) {
    const rows = (await sql`SELECT * FROM staff_users WHERE id = ${userId}`) as StaffUserRow[];
    return rows[0] ? toStaffUser(rows[0]) : undefined;
  }
  return memoryStaffUsers.find((user) => user.id === userId);
};

export const findStaffByEmail = async (email: string): Promise<StaffUser | undefined> => {
  if (hasDatabase && sql) {
    const rows = (await sql`SELECT * FROM staff_users WHERE email = ${email}`) as StaffUserRow[];
    return rows[0] ? toStaffUser(rows[0]) : undefined;
  }
  return memoryStaffUsers.find((user) => user.email.toLowerCase() === email.toLowerCase());
};

export const findStaffByPinHolder = async (predicate: (user: StaffUser) => boolean): Promise<StaffUser | undefined> => {
  const users = await listStaffUsers();
  return users.find((user) => Boolean(user.pinHash) && predicate(user));
};

export const createStaffUser = async (input: StaffUser): Promise<StaffUser> => {
  if (hasDatabase && sql) {
    const rows = (await sql`
      INSERT INTO staff_users (id, name, email, role, password_hash, pin_hash)
      VALUES (${input.id}, ${input.name}, ${input.email}, ${input.role}, ${input.passwordHash}, ${input.pinHash ?? null})
      RETURNING *
    `) as StaffUserRow[];
    return toStaffUser(rows[0]);
  }
  memoryStaffUsers.push(input);
  return input;
};

export const updateStaffUser = async (
  userId: string,
  changes: Partial<StaffUser>
): Promise<StaffUser | undefined> => {
  if (hasDatabase && sql) {
    const existing = await findStaffById(userId);
    if (!existing) return undefined;
    const merged = { ...existing, ...changes, id: userId };
    const rows = (await sql`
      UPDATE staff_users
      SET name = ${merged.name}, email = ${merged.email}, role = ${merged.role},
          password_hash = ${merged.passwordHash}, pin_hash = ${merged.pinHash ?? null}
      WHERE id = ${userId}
      RETURNING *
    `) as StaffUserRow[];
    return rows[0] ? toStaffUser(rows[0]) : undefined;
  }
  const index = memoryStaffUsers.findIndex((user) => user.id === userId);
  if (index === -1) return undefined;
  memoryStaffUsers[index] = { ...memoryStaffUsers[index], ...changes, id: userId };
  return memoryStaffUsers[index];
};

export const deleteStaffUser = async (userId: string): Promise<boolean> => {
  if (hasDatabase && sql) {
    const rows = (await sql`DELETE FROM staff_users WHERE id = ${userId} RETURNING id`) as { id: string }[];
    return rows.length > 0;
  }
  const index = memoryStaffUsers.findIndex((user) => user.id === userId);
  if (index === -1) return false;
  memoryStaffUsers.splice(index, 1);
  return true;
};

export const createSession = async (userId: string): Promise<Session> => {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  if (hasDatabase && sql) {
    await sql`INSERT INTO sessions (token, user_id, expires_at) VALUES (${hashToken(token)}, ${userId}, ${expiresAt})`;
  } else {
    memorySessions.push({ token: hashToken(token), userId, expiresAt });
  }

  // The raw token is only ever returned to the caller at creation time; only its hash is stored.
  return { token, userId, expiresAt };
};

export const getSession = async (rawToken: string): Promise<Session | undefined> => {
  const tokenHash = hashToken(rawToken);

  if (hasDatabase && sql) {
    const rows = (await sql`SELECT * FROM sessions WHERE token = ${tokenHash}`) as SessionRow[];
    const row = rows[0];
    if (!row || isExpired(row.expires_at)) return undefined;
    return { token: rawToken, userId: row.user_id, expiresAt: row.expires_at };
  }

  const session = memorySessions.find((entry) => entry.token === tokenHash);
  if (!session || isExpired(session.expiresAt)) return undefined;
  return { token: rawToken, userId: session.userId, expiresAt: session.expiresAt };
};

export const deleteSession = async (rawToken: string): Promise<void> => {
  const tokenHash = hashToken(rawToken);

  if (hasDatabase && sql) {
    await sql`DELETE FROM sessions WHERE token = ${tokenHash}`;
    return;
  }

  const index = memorySessions.findIndex((entry) => entry.token === tokenHash);
  if (index !== -1) memorySessions.splice(index, 1);
};

export const createPasswordResetToken = async (userId: string): Promise<string> => {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  const tokenHash = hashToken(token);

  if (hasDatabase && sql) {
    await sql`INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (${tokenHash}, ${userId}, ${expiresAt})`;
  } else {
    memoryResetTokens.push({ tokenHash, userId, expiresAt });
  }

  return token;
};

export const consumePasswordResetToken = async (rawToken: string): Promise<string | undefined> => {
  const tokenHash = hashToken(rawToken);

  if (hasDatabase && sql) {
    const rows = (await sql`DELETE FROM password_reset_tokens WHERE token_hash = ${tokenHash} RETURNING *`) as ResetTokenRow[];
    const row = rows[0];
    if (!row || isExpired(row.expires_at)) return undefined;
    return row.user_id;
  }

  const index = memoryResetTokens.findIndex((entry) => entry.tokenHash === tokenHash);
  if (index === -1) return undefined;
  const [removed] = memoryResetTokens.splice(index, 1);
  if (isExpired(removed.expiresAt)) return undefined;
  return removed.userId;
};
