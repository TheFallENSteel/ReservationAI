import test from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';

import { app } from '../src/app.js';

const withServer = async (callback: (baseUrl: string) => Promise<void>) => {
  const server = app.listen(0);

  await new Promise<void>((resolve) => {
    server.once('listening', () => resolve());
  });

  const address = server.address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('Server did not bind to a valid network address');
  }

  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await callback(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
};

const request = async (baseUrl: string, path: string, method = 'GET', body?: unknown, token?: string) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  return { status: response.status, json: await response.json() };
};

test('health endpoint responds successfully', async () => {
  await withServer(async (baseUrl) => {
    const result = await request(baseUrl, '/health');
    assert.equal(result.status, 200);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.service, 'reservation-system');
    assert.equal(result.json.database, 'in-memory');
  });
});

test('user settings endpoint returns expected keys', async () => {
  await withServer(async (baseUrl) => {
    const result = await request(baseUrl, '/api/user/settings');
    assert.equal(result.status, 200);
    assert.ok(result.json.settings);
    assert.ok(result.json.settings.slotMinutes);
    assert.ok(result.json.settings.minimumReservationMinutes);
  });
});

test('reserving an unknown resource returns 404', async () => {
  await withServer(async (baseUrl) => {
    const result = await request(baseUrl, '/api/user/reserve/table-does-not-exist', 'POST', { guestName: 'Test' });
    assert.equal(result.status, 404);
    assert.equal(result.json.ok, false);
  });
});

test('reserving a known resource creates a reservation that can be fetched and cancelled', async () => {
  await withServer(async (baseUrl) => {
    const resources = await request(baseUrl, '/api/user/reservation/resources');
    const resourceId = resources.json.resources[0].id;

    const created = await request(baseUrl, `/api/user/reserve/${resourceId}`, 'POST', {
      guestName: 'Test Guest',
      email: 'test@example.com',
      guestCount: 2,
      date: '2026-08-20',
      startTime: '19:00',
      endTime: '20:00'
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.reservation.status, 'pending');

    const reservationId = created.json.reservation.id;

    const fetched = await request(baseUrl, `/api/user/reservation/${resourceId}/${reservationId}`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.json.reservation.guestName, 'Test Guest');

    const cancelled = await request(baseUrl, `/api/user/reserve/${resourceId}/${reservationId}`, 'DELETE');
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.json.deleted.status, 'cancelled');
  });
});

test('staff routes reject requests without a session token', async () => {
  await withServer(async (baseUrl) => {
    const result = await request(baseUrl, '/api/staff/reservation');
    assert.equal(result.status, 401);
  });
});

test('staff login rejects invalid credentials', async () => {
  await withServer(async (baseUrl) => {
    const result = await request(baseUrl, '/api/staff/login', 'POST', {
      email: 'manager@example.com',
      password: 'wrong-password'
    });
    assert.equal(result.status, 401);
  });
});

test('staff login succeeds and grants access to staff routes but not admin routes', async () => {
  await withServer(async (baseUrl) => {
    const login = await request(baseUrl, '/api/staff/login', 'POST', {
      email: 'manager@example.com',
      password: 'ManagerPass123!'
    });
    assert.equal(login.status, 200);
    assert.ok(login.json.token);
    assert.equal(login.json.user.role, 'manager');

    const token = login.json.token;

    const reservations = await request(baseUrl, '/api/staff/reservation', 'GET', undefined, token);
    assert.equal(reservations.status, 200);
    assert.ok(Array.isArray(reservations.json.reservations));

    const adminAttempt = await request(baseUrl, '/api/admin/user', 'GET', undefined, token);
    assert.equal(adminAttempt.status, 403);
  });
});

test('admin login grants access to admin-only routes', async () => {
  await withServer(async (baseUrl) => {
    const login = await request(baseUrl, '/api/staff/login', 'POST', {
      email: 'admin@example.com',
      password: 'AdminPass123!'
    });
    assert.equal(login.status, 200);

    const users = await request(baseUrl, '/api/admin/user', 'GET', undefined, login.json.token);
    assert.equal(users.status, 200);
    assert.ok(Array.isArray(users.json.users));
    assert.equal(users.json.users[0].passwordHash, undefined);
  });
});

test('staff can merge reservations into a table block and split them apart again', async () => {
  await withServer(async (baseUrl) => {
    const login = await request(baseUrl, '/api/staff/login', 'POST', {
      email: 'manager@example.com',
      password: 'ManagerPass123!'
    });
    const token = login.json.token;

    const list = await request(baseUrl, '/api/staff/reservation', 'GET', undefined, token);
    const reservationIds = list.json.reservations.map((reservation: { id: string }) => reservation.id);

    const merged = await request(baseUrl, '/api/staff/reservation/merge', 'POST', { reservationIds }, token);
    assert.equal(merged.status, 201);
    assert.ok(merged.json.block.id);

    const split = await request(baseUrl, '/api/staff/reservation/split', 'POST', { blockId: merged.json.block.id }, token);
    assert.equal(split.status, 200);
    assert.deepEqual(split.json.released.sort(), reservationIds.sort());
  });
});
