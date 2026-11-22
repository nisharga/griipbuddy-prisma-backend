import { execSync } from "child_process";

/** Bring the test database schema up to date once per run. */
export default function setup() {
  const url =
    process.env.TEST_DATABASE_URL ??
    "postgresql://griipbuddy:griipbuddy@localhost:5432/griipbuddy_test?schema=public";
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
