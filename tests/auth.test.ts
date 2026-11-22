import { beforeAll, describe, expect, it } from "vitest";
import { ADMIN, api, auth, login, resetDb, seedBasics } from "./helpers";

describe("auth, staff & roles", () => {
  let token: string;
  let warehouseId: string;
  beforeAll(async () => {
    await resetDb();
    ({ token, warehouseId } = await seedBasics());
  });

  it("rejects a wrong password with 401 and a generic message", async () => {
    const res = await api()
      .post("/api/v1/user/admin/login")
      .send({ ...ADMIN, password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, message: "Invalid phone number or password." });
  });

  it("logs in: tokens + JWT with the role the admin middleware checks", async () => {
    const res = await api().post("/api/v1/user/admin/login").send(ADMIN);
    expect(res.status).toBe(200);
    const payload = JSON.parse(Buffer.from(res.body.data.access_token.split(".")[1], "base64url").toString());
    expect(payload.role).toBe("SUPER_ADMIN");
    expect(res.body.data.refresh_token).toBeTruthy();
    expect(res.body.data.user.password).toBeUndefined();
  });

  it("returns the profile with _id and effective permissions; 401 without a token", async () => {
    expect((await api().get("/api/v1/user")).status).toBe(401);
    const res = await api().get("/api/v1/user").set(auth(token));
    expect(res.body.data).toMatchObject({ full_name: "Super Admin", role: "SUPER_ADMIN" });
    expect(res.body.data._id).toBe(res.body.data.id);
    expect(res.body.data.permissions.length).toBeGreaterThan(60);
  });

  it("creates a role, a staff member with it, and enforces permissions", async () => {
    const role = await api()
      .post("/api/v1/roles")
      .set(auth(token))
      .send({ role_name: "Editor", permissions: ["product.view"] });
    expect(role.status).toBe(201);
    expect(
      (
        await api()
          .post("/api/v1/roles")
          .set(auth(token))
          .send({ role_name: "X", permissions: ["nope"] })
      ).status
    ).toBe(400);

    const staff = await api().post("/api/v1/user/recruit/staff").set(auth(token)).send({
      full_name: "Test Staff",
      phone_number: "01800000000",
      password: "Staff@1234",
      role_ref: role.body.data._id,
      outlet: warehouseId,
    });
    expect(staff.status).toBe(201);
    expect(staff.body.data).toMatchObject({
      role: "Editor",
      permissions: ["product.view"],
      role_ref: role.body.data._id,
    });
    expect(staff.body.data.outlet.name).toBe("Central Warehouse");

    const dup = await api().post("/api/v1/user/recruit/staff").set(auth(token)).send({
      full_name: "Dup",
      phone_number: "01800000000",
      password: "Staff@1234",
      role_ref: role.body.data._id,
    });
    expect(dup.status).toBe(409);

    const staffToken = await login("01800000000", "Staff@1234");
    expect((await api().post("/api/v1/roles").set(auth(staffToken)).send({ role_name: "Hack" })).status).toBe(
      403
    );

    // Changing the role's permissions updates its staff.
    await api()
      .patch("/api/v1/permissions")
      .set(auth(token))
      .send({ id: role.body.data._id, permissions: ["order.view"] });
    const after = await api().get(`/api/v1/user/${staff.body.data._id}`).set(auth(token));
    expect(after.body.data.permissions).toEqual(["order.view"]);

    expect((await api().delete(`/api/v1/roles/${role.body.data._id}`).set(auth(token))).status).toBe(400); // in use
    const list = await api()
      .get("/api/v1/user/admin/all/roles?role=SUPER_ADMIN,Editor&page=1&limit=10")
      .set(auth(token));
    expect(list.body.data.meta.total).toBe(2);

    // Soft delete frees the phone number.
    expect((await api().delete(`/api/v1/user/${staff.body.data._id}`).set(auth(token))).status).toBe(200);
    const again = await api().post("/api/v1/user/recruit/staff").set(auth(token)).send({
      full_name: "Rehired",
      phone_number: "01800000000",
      password: "Staff@1234",
      role_ref: role.body.data._id,
    });
    expect(again.status).toBe(201);
  });

  it("answers unknown routes with a JSON 404", async () => {
    const res = await api().get("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(res.body.message).toBe("API Not Found");
  });
});
