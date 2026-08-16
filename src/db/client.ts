import { neon } from '@neondatabase/serverless';

// Neon's HTTP driver needs no pooling/teardown, which suits Vercel's serverless functions.
export const hasDatabase = Boolean(process.env.DATABASE_URL);

export const sql = hasDatabase ? neon(process.env.DATABASE_URL as string) : null;
