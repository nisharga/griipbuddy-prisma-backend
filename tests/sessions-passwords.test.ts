import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN, api, auth, login, prisma, resetDb, seedBasics } from "./helpers";

/** Server-side logout (token_version) and staff passwords: change, forgot / reset by SMS code. */
describe("logout and passwords", () => {
  beforeEach(async () => {
    await resetDb();
    await seedBasics();
  });

  const adminLogin = (password = ADMIN.password) =>
    api().post("/api/v1/user/admin/login").send({ phone_number: ADMIN.phone_number, password });

  it("logout ends every session: old access and refresh tokens stop working", async () => {
    const laptop = (await adminLogin()).body.data;
    const phone = (await adminLogin()).body.data;

    expect((await api().post("/api/v1/user/logout").set(auth(laptop.access_token))).status).toBe(200);

    const oldAccess = await api().get("/api/v1/user").set(auth(phone.access_token));
    expect(oldAccess.status).toBe(401);
    expect(oldAccess.body.message).toMatch(/logged out/);
    const oldRefresh = await api()
      .post("/api/v1/user/refresh-token")
      .send({ refresh_token: phone.refresh_token });
    expect(oldRefresh.status).toBe(401);

    // Logging in again works.
    expect(
      (
        await api()
          .get("/api/v1/user")
          .set(auth(await login(ADMIN.phone_number, ADMIN.password)))
      ).status
    ).toBe(200);
  });

  it("change my password: needs the current one, returns new tokens, logs out other devices", async () => {
    const other = (await adminLogin()).body.data.access_token;
    const mine = (await adminLogin()).body.data.access_token;

    const wrong = await api()
      .patch("/api/v1/user/change-password")
      .set(auth(mine))
      .send({ old_password: "nope", new_password: "NewPass@123" });
    expect(wrong.status).toBe(400);

    const changed = await api()
      .patch("/api/v1/user/change-password")
      .set(auth(mine))
      .send({ old_password: ADMIN.password, new_password: "NewPass@123" });
    expect(changed.status).toBe(200);

    expect((await api().get("/api/v1/user").set(auth(changed.body.data.access_token))).status).toBe(200);
    expect((await api().get("/api/v1/user").set(auth(other))).status).toBe(401);
    expect((await adminLogin("NewPass@123")).status).toBe(200);
    expect((await adminLogin()).status).toBe(401);
  });

  it("forgot / reset password by SMS code (staff only, codes can't be mixed with login codes)", async () => {
    const session = (await adminLogin()).body.data.access_token;

    // Unknown number: same reply, no code.
    const unknown = await api().post("/api/v1/user/forgot-password").send({ phone_number: "01799999999" });
    expect(unknown.status).toBe(200);
    expect(unknown.body.data.dev_otp).toBeUndefined();

    const sent = await api().post("/api/v1/user/forgot-password").send({ phone_number: ADMIN.phone_number });
    const code = sent.body.data.dev_otp;
    expect(code).toMatch(/^\d{6}$/);
    expect(await prisma.otpCode.count({ where: { purpose: "password_reset" } })).toBe(1);

    const reset = await api()
      .post("/api/v1/user/reset-password")
      .send({ phone_number: ADMIN.phone_number, otp: code, new_password: "Reset@1234" });
    expect(reset.status).toBe(200);

    expect((await adminLogin("Reset@1234")).status).toBe(200);
    expect((await api().get("/api/v1/user").set(auth(session))).status).toBe(401); // logged out
    // The code works once.
    const again = await api()
      .post("/api/v1/user/reset-password")
      .send({ phone_number: ADMIN.phone_number, otp: code, new_password: "Other@1234" });
    expect(again.status).toBe(400);
  });

  it("customers can log out too", async () => {
    const { dev_otp } = (await api().post("/api/v1/customer/otp/send").send({ phone_number: "01733333333" }))
      .body.data;
    const { access_token } = (
      await api().post("/api/v1/customer/otp/verify").send({ phone_number: "01733333333", otp: dev_otp })
    ).body.data;

    expect((await api().post("/api/v1/customer/logout").set(auth(access_token))).status).toBe(200);
    expect((await api().get("/api/v1/customer/me").set(auth(access_token))).status).toBe(401);
  });

  it("an admin setting a staff password logs that staff member out", async () => {
    const adminToken = (await adminLogin()).body.data.access_token;
    const admin = await prisma.user.findFirstOrThrow({ where: { phone_number: ADMIN.phone_number } });
    const before = admin.token_version;

    await api()
      .patch(`/api/v1/user/admin/change-password/${admin.id}`)
      .set(auth(adminToken))
      .send({ new_password: "ByAdmin@123" });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(after.token_version).toBe(before + 1);
    expect((await api().get("/api/v1/user").set(auth(adminToken))).status).toBe(401);
  });
});
