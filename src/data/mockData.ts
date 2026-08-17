import { hashSecret } from '../auth/password.js';

export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'archived';

export interface TableResource {
  id: string;
  name: string;
  capacity: number;
  zone: string;
  status: 'available' | 'occupied' | 'disabled';
  minGuests: number;
  maxGuests: number;
}

export interface Reservation {
  id: string;
  resourceId: string;
  guestName: string;
  email: string;
  phone: string;
  guestCount: number;
  date: string;
  startTime: string;
  endTime: string;
  status: ReservationStatus;
  notes?: string;
  blockId?: string;
}

export type StaffRole = 'admin' | 'manager' | 'staff';

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  passwordHash: string;
  pinHash?: string;
}

export interface Session {
  token: string;
  userId: string;
  expiresAt: string;
}

export interface PasswordResetToken {
  tokenHash: string;
  userId: string;
  expiresAt: string;
}

export interface Zone {
  id: string;
  name: string;
}

export interface TableBlock {
  id: string;
  label: string;
  tableIds: string[];
  date: string;
  startTime: string;
  endTime: string;
}

export interface AuditLog {
  id: string;
  action: string;
  actor: string;
  timestamp: string;
}

export const resources: TableResource[] = [
  { id: 'table-1', name: 'Table 1', capacity: 2, zone: 'Garden', status: 'available', minGuests: 1, maxGuests: 2 },
  { id: 'table-2', name: 'Table 2', capacity: 4, zone: 'Garden', status: 'available', minGuests: 2, maxGuests: 4 },
  { id: 'table-3', name: 'Table 3', capacity: 6, zone: 'Indoor', status: 'occupied', minGuests: 3, maxGuests: 6 },
  { id: 'table-4', name: 'Table 4', capacity: 8, zone: 'Indoor', status: 'available', minGuests: 4, maxGuests: 8 }
];

export const reservations: Reservation[] = [
  {
    id: 'res-1001',
    resourceId: 'table-3',
    guestName: 'Anna Novak',
    email: 'anna@example.com',
    phone: '+420123456789',
    guestCount: 4,
    date: '2026-08-18',
    startTime: '18:30',
    endTime: '20:00',
    status: 'confirmed',
    notes: 'Window seat preferred'
  },
  {
    id: 'res-1002',
    resourceId: 'table-1',
    guestName: 'Jakub Kolar',
    email: 'jakub@example.com',
    phone: '+420987654321',
    guestCount: 2,
    date: '2026-08-18',
    startTime: '19:00',
    endTime: '20:30',
    status: 'pending'
  }
];

// Demo credentials only - rotate these (or seed your own) before deploying anywhere real.
export const staffUsers: StaffUser[] = [
  {
    id: 'staff-admin',
    name: 'Admin Test',
    email: 'admin@example.com',
    role: 'admin',
    passwordHash: hashSecret('AdminPass123!')
  },
  {
    id: 'staff-1',
    name: 'Manager Test',
    email: 'manager@example.com',
    role: 'manager',
    passwordHash: hashSecret('ManagerPass123!')
  },
  {
    id: 'staff-2',
    name: 'Waitstaff Test',
    email: 'staff@example.com',
    role: 'staff',
    passwordHash: hashSecret('StaffPass123!'),
    pinHash: hashSecret('1234')
  }
];

export const sessions: Session[] = [];

export const passwordResetTokens: PasswordResetToken[] = [];

export const zones: Zone[] = [
  { id: 'zone-1', name: 'Garden' },
  { id: 'zone-2', name: 'Indoor' }
];

export const tableBlocks: TableBlock[] = [
  { id: 'block-1', label: 'Connected tables', tableIds: ['table-2', 'table-3'], date: '2026-08-18', startTime: '19:00', endTime: '21:00' }
];

export const auditLogs: AuditLog[] = [
  { id: 'log-1', action: 'reservation.created', actor: 'staff-1', timestamp: '2026-08-10T10:00:00.000Z' }
];

export const settings = {
  slotMinutes: 30,
  cleanupMinutes: 15,
  minimumReservationMinutes: 60,
  maximumReservationMinutes: 180,
  minimumLeadMinutes: 30,
  archiveRetentionDays: 365,
  dashboardPreviewDays: 7,
  forecastDays: 3,
  emailTemplate: 'Dobrý den {guestName},\n\nVaše rezervace na jméno {guestName} pro {guestCount} osob dne {date} od {startTime} do {endTime} byla úspěšně přijata.\n\nTěšíme se na Vaši návštěvu!',
  emailTemplates: {
    confirmation: 'Dobrý den {guestName},\n\nVaše rezervace (kód: {reservationId}) pro {guestCount} osob dne {date} od {startTime} do {endTime} na stůl {tableName} je potvrzena.\n\nTěšíme se na Vaši návštěvu!',
    change: 'Dobrý den {guestName},\n\nVaše rezervace (kód: {reservationId}) byla upravena na nový termín dne {date} od {startTime} do {endTime} pro {guestCount} osob.\n\nV případě dotazů nás neváhejte kontaktovat.',
    verification2fa: 'Dobrý den {guestName},\n\npro potvrzení Vaší rezervace dne {date} ({startTime}–{endTime}) zadejte ověřovací kód:\n\n{verificationCode}\n\nNebo klikněte na tento odkaz:\n{confirmationUrl}\n\nKód je platný po dobu 15 minut.',
    cancellation: 'Dobrý den {guestName},\n\nVaše rezervace na jméno {guestName} dne {date} ({startTime}–{endTime}) byla zrušena.\n\nDěkujeme za pochopení.'
  },
  openingHours: {
    monday: { open: '12:00', close: '23:00' },
    tuesday: { open: '12:00', close: '23:00' },
    wednesday: { open: '12:00', close: '23:00' },
    thursday: { open: '12:00', close: '23:00' },
    friday: { open: '12:00', close: '24:00' },
    saturday: { open: '12:00', close: '24:00' },
    sunday: { open: '12:00', close: '22:00' }
  }
};
