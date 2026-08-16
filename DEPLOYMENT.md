# Deploying to Vercel (free tier) + Neon Postgres

This project is a plain Express + TypeScript API with a small static frontend (`public/`). It runs as a single
Vercel Serverless Function ([api/index.ts](api/index.ts)) backed by a [Neon](https://neon.tech) Postgres database.
Without a database configured, it falls back to in-memory mock data — handy for local development and previews.

## 1. Create a Neon database

1. Sign up at [neon.tech](https://neon.tech) (has a free tier) and create a new project.
2. Copy the pooled connection string from the Neon dashboard (**Connection Details**). It looks like:
   ```
   postgres://<user>:<password>@<endpoint>.neon.tech/<database>?sslmode=require
   ```

## 2. Configure environment variables locally

1. Copy [.env.example](.env.example) to `.env`.
2. Paste your Neon connection string into `DATABASE_URL`.
3. Install dependencies and run the migration/seed script:
   ```
   npm install
   npm run db:migrate
   ```
   This creates all tables (`resources`, `reservations`, `table_blocks`, `settings`, `staff_users`, `sessions`,
   `password_reset_tokens`, `zones`, `logs`) and seeds them from [src/data/mockData.ts](src/data/mockData.ts).
   It's safe to re-run (uses `ON CONFLICT DO NOTHING`).
4. Start the app locally against Neon:
   ```
   npm run dev
   ```
   Visit `http://localhost:3000`. `/health` reports `"database": "neon"` once it's wired up correctly
   (it reports `"in-memory"` whenever `DATABASE_URL` is unset).

## 3. Default seeded staff accounts

The seed data creates three demo accounts — **rotate or delete these before any real use**:

| Role    | E-mail               | Password         | PIN  |
|---------|-----------------------|------------------|------|
| admin   | admin@example.com     | AdminPass123!    | —    |
| manager | manager@example.com   | ManagerPass123!  | —    |
| staff   | staff@example.com     | StaffPass123!    | 1234 |

Change these via `POST /api/staff/password/reset` (using a token from `/api/staff/password/forgot`) or by
deleting/recreating the users through `/api/admin/user` once logged in as admin.

## 4. Deploy to Vercel

1. Push this repository to GitHub (or GitLab/Bitbucket).
2. In the [Vercel dashboard](https://vercel.com/new), import the repository. Framework preset: **Other** (no
   build command is required — [api/index.ts](api/index.ts) is auto-detected as a Serverless Function, and
   everything under `public/` is served as static assets).
3. Before the first deploy, add an environment variable in the Vercel project settings
   (**Settings → Environment Variables**), applied to Production, Preview and Development:
   - `DATABASE_URL` = your Neon connection string.
4. Deploy. Vercel builds `api/index.ts` (which just re-exports the Express `app`) into a serverless function,
   and `vercel.json` rewrites `/health` and `/api/*` requests to it while serving `public/*.html` for the
   frontend routes (`/`, `/reserve`, `/reserve/manage`, `/staff/login`, `/staff/dashboard`).
5. Run `npm run db:migrate` once from your machine (with `DATABASE_URL` pointed at the same Neon database used
   in production) to create and seed the schema before the first real request — the app itself never runs DDL.

### Why Neon's HTTP driver works well on Vercel's free tier

[`@neondatabase/serverless`](https://github.com/neondatabase/serverless) talks to Postgres over HTTP instead of
a persistent TCP connection, so there's no connection-pool exhaustion across concurrent serverless invocations
and no cold-start connection overhead — a good fit for Vercel's free-tier function limits.

## 5. Local development without a database

Everything works with `DATABASE_URL` unset: `src/data/repository.ts`, `src/data/staffRepository.ts` and
`src/data/adminRepository.ts` all fall back to mutating the in-memory arrays in `src/data/mockData.ts`. This is
what `npm test` relies on, so CI doesn't need a real database.

## 6. Project structure reference

- `src/app.ts` — Express app (all routes, auth middleware wiring, static frontend routes).
- `src/server.ts` — local-only entry point (`app.listen`); not used on Vercel.
- `api/index.ts` — Vercel serverless entry point (exports the same Express `app`).
- `src/db/` — Neon client, SQL schema reference, and the migration/seed script.
- `src/data/` — dual-mode (Neon or in-memory) repositories.
- `src/middleware/auth.ts` — session/role-based auth guards (`requireAuth`, `requireRole`).
- `public/` — static frontend (guest booking flow + staff/admin dashboard), plain HTML/CSS/JS, no build step.

## 7. Known simplifications (worth revisiting for a production deployment)

- `POST /api/staff/password/forgot` has no email provider wired up, so it returns the reset token directly in
  the API response instead of emailing it. Wire up an email service (Resend, Postmark, etc.) and stop returning
  the token before using this for real users.
- `POST /api/staff/register` always creates a `manager` account; provisioning `admin`/`staff` accounts requires
  an existing admin using `POST /api/admin/user`.
