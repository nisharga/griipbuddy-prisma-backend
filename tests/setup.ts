/**
 * Runs before every test file, before any app module is imported.
 * Tests use their own database (never the dev one) and no Redis (inline jobs).
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://griipbuddy:griipbuddy@localhost:5432/griipbuddy_test?schema=public";
process.env.REDIS_URL = "";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-test-access-secret-0001";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-test-refresh-secret-01";
process.env.BCRYPT_SALT_ROUNDS = "8";
process.env.SERVER_BASE_URL = "http://localhost:5007";
