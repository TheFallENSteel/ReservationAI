import 'dotenv/config';

import { hasDatabase, sql } from './client.js';
import {
  auditLogs,
  reservations,
  resources,
  settings,
  staffUsers,
  tableBlocks,
  zones
} from '../data/mockData.js';

if (!hasDatabase || !sql) {
  throw new Error('DATABASE_URL is not set. Add it to your environment or .env file before running migrations.');
}

const db = sql;

const run = async () => {
  await db`
    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      zone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available',
      min_guests INTEGER NOT NULL,
      max_guests INTEGER NOT NULL
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS table_blocks (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      table_ids TEXT[] NOT NULL,
      date DATE NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      guest_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      guest_count INTEGER NOT NULL,
      date DATE NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      block_id TEXT REFERENCES table_blocks(id) ON DELETE SET NULL
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS staff_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      pin_hash TEXT
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS reservation_verifications (
      reservation_id TEXT PRIMARY KEY REFERENCES reservations(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS zones (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  console.log('Schema ready. Seeding initial data...');

  for (const zone of zones) {
    await db`INSERT INTO zones (id, name) VALUES (${zone.id}, ${zone.name}) ON CONFLICT (id) DO NOTHING`;
  }

  for (const resource of resources) {
    await db`
      INSERT INTO resources (id, name, capacity, zone, status, min_guests, max_guests)
      VALUES (${resource.id}, ${resource.name}, ${resource.capacity}, ${resource.zone}, ${resource.status}, ${resource.minGuests}, ${resource.maxGuests})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  for (const block of tableBlocks) {
    await db`
      INSERT INTO table_blocks (id, label, table_ids, date, start_time, end_time)
      VALUES (${block.id}, ${block.label}, ${block.tableIds}, ${block.date}, ${block.startTime}, ${block.endTime})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  for (const reservation of reservations) {
    await db`
      INSERT INTO reservations (id, resource_id, guest_name, email, phone, guest_count, date, start_time, end_time, status, notes, block_id)
      VALUES (${reservation.id}, ${reservation.resourceId}, ${reservation.guestName}, ${reservation.email}, ${reservation.phone}, ${reservation.guestCount}, ${reservation.date}, ${reservation.startTime}, ${reservation.endTime}, ${reservation.status}, ${reservation.notes ?? null}, ${reservation.blockId ?? null})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  for (const user of staffUsers) {
    await db`
      INSERT INTO staff_users (id, name, email, role, password_hash, pin_hash)
      VALUES (${user.id}, ${user.name}, ${user.email}, ${user.role}, ${user.passwordHash}, ${user.pinHash ?? null})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  for (const log of auditLogs) {
    await db`
      INSERT INTO logs (id, action, actor, timestamp)
      VALUES (${log.id}, ${log.action}, ${log.actor}, ${log.timestamp})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  await db`
    INSERT INTO settings (key, value)
    VALUES ('default', ${JSON.stringify(settings)}::jsonb)
    ON CONFLICT (key) DO NOTHING
  `;

  console.log('Seed complete.');
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
