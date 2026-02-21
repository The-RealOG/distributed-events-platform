import { defineConfig } from 'drizzle-kit';

// Only used by `drizzle-kit generate`, which diffs the schema offline; no database needed.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
});
