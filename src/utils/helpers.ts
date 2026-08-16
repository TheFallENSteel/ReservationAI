import type { StaffRole, StaffUser } from '../data/mockData.js';

export const STAFF_ROLES: StaffRole[] = ['admin', 'manager', 'staff'];

export const toSafeUser = (user: StaffUser) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role
});

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
