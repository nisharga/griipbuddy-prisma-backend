import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "@/config";
import { api, resetDb, seedBasics } from "./helpers";

/** OTP_STATIC_CODE: a fixed login code for testing without SMS. */
describe("static OTP (testing without SMS)", () => {
  const otp = config.otp as { staticCode?: string; staticPhones: string[] };

  beforeAll(async () => {
    await resetDb();
    await seedBasics();
    otp.staticCode = "123456";
    otp.staticPhones = ["+8801911111111"]; // any format
  });

  afterAll(() => {
    otp.staticCode = undefined;
    otp.staticPhones = [];
  });

  it("listed numbers log in with the fixed code", async () => {
    const sent = await api().post("/api/v1/customer/otp/send").send({ phone_number: "01911111111" });
    expect(sent.status).toBe(200);
    expect(sent.body.data.dev_otp).toBe("123456");

    const login = await api()
      .post("/api/v1/customer/otp/verify")
      .send({ phone_number: "01911111111", otp: "123456" });
    expect(login.status).toBe(200);
    expect(login.body.data.access_token).toBeTruthy();
  });

  it("other numbers still get a random code", async () => {
    const sent = await api().post("/api/v1/customer/otp/send").send({ phone_number: "01922222222" });
    expect(sent.body.data.dev_otp).toMatch(/^\d{6}$/);
    expect(sent.body.data.dev_otp).not.toBe("123456");
  });
});
