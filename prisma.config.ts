// Load .env into process.env (same as `import "dotenv/config"`, whose types
// only resolve under node16/bundler module resolution).
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  // Every .prisma file in this folder is one schema (main.prisma has the database settings).
  schema: path.join("prisma", "schema"),
  migrations: { path: path.join("prisma", "migrations"), seed: "tsx prisma/seed.ts" },
});
