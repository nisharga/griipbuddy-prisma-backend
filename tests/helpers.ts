import request from "supertest";
import bcrypt from "bcryptjs";
import { createApp } from "@/app";
import { prisma } from "@/shared/prisma";
import { PERMISSIONS } from "@/constants/permissions";

export const app = createApp();
export const api = () => request(app);
export { prisma };

/** Empty every table (keeps the schema and migration history). */
export const resetDb = async () => {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`
  );
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE "orders_order_serial_id_seq" RESTART WITH 1001`);
};

export const ADMIN = { phone_number: "01700000000", password: "Admin@12345" };

/** Super admin + a role, a warehouse, a category/sub-category; returns ids and an admin token. */
export const seedBasics = async () => {
  const role = await prisma.role.create({
    data: { role_name: "SUPER_ADMIN", permissions: [...PERMISSIONS] },
  });
  await prisma.user.create({
    data: {
      full_name: "Super Admin",
      phone_number: ADMIN.phone_number,
      password: await bcrypt.hash(ADMIN.password, 8),
      role: "SUPER_ADMIN",
      role_ref_id: role.id,
      permissions: [...PERMISSIONS],
    },
  });
  const token = await login(ADMIN.phone_number, ADMIN.password);
  const warehouse = await api()
    .post("/api/v1/business-location")
    .set(auth(token))
    .send({ name: "Central Warehouse", type: "WAREHOUSE", address: { local_address: "Tongi, Gazipur" } });
  const category = await api().post("/api/v1/category").set(auth(token)).send({ name_en: "Footwear" });
  const sub = await api()
    .post("/api/v1/sub-category")
    .set(auth(token))
    .send({ name_en: "Sneakers", category: category.body.data._id });
  return {
    token,
    warehouseId: warehouse.body.data._id as string,
    categoryId: category.body.data._id as string,
    subId: sub.body.data._id as string,
  };
};

export const login = async (phone_number: string, password: string) => {
  const res = await api().post("/api/v1/user/admin/login").send({ phone_number, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.access_token as string;
};

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
