import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, prisma, resetDb, seedBasics } from "./helpers";

/** Storefront customers: phone + OTP login, profile, and "my orders". */
describe("customer phone + OTP login", () => {
  let adminToken: string;
  let productId: string;
  let variantId: string;
  let customerToken: string;

  const sendOtp = (phone_number: string) => api().post("/api/v1/customer/otp/send").send({ phone_number });
  const verifyOtp = (phone_number: string, otp: string) =>
    api().post("/api/v1/customer/otp/verify").send({ phone_number, otp });
  /** Lets the next code be requested right away (skips the 60 s wait). */
  const skipResendWait = (phone: string) =>
    prisma.otpCode.updateMany({
      where: { phone },
      data: { createdAt: new Date(Date.now() - 2 * 60 * 1000) },
    });

  const placeOrder = (customer_phone: string, customer_name: string) =>
    api()
      .post("/api/v1/order")
      .send({
        customer_name,
        customer_phone,
        payment_type: "CASH_ON_DELIVERY",
        delivery_charge: 80,
        total_amount: 1080,
        delivery_address: { address: "House 1, Dhaka" },
        products: [{ product: productId, total_quantity: 1, selected_variant: { _id: variantId } }],
      });

  beforeAll(async () => {
    await resetDb();
    const basics = await seedBasics();
    adminToken = basics.token;

    const product = await api()
      .post("/api/v1/product")
      .set(auth(adminToken))
      .send({
        name: "Wallet",
        category: basics.categoryId,
        sku: "WLT",
        variantsCombination: [{ sale_price: 1000 }],
      });
    productId = product.body.data._id;
    variantId = product.body.data.variants[0]._id;
    const rows = await api()
      .get(`/api/v1/stocks?sku=WLT&businessLocationId=${basics.warehouseId}`)
      .set(auth(adminToken));
    await api()
      .post("/api/v1/stocks/adjustment")
      .set(auth(adminToken))
      .send({
        business_location: basics.warehouseId,
        action: "ADDITION",
        products: [{ stock: rows.body.data.data[0]._id, quantity: 10 }],
      });

    // Guest orders placed before the customer ever logs in (one in +880 format).
    expect((await placeOrder("+8801712345678", "Rahim Uddin")).status).toBe(201);
    expect((await placeOrder("01811111111", "Someone Else")).status).toBe(201);
  });

  it("rejects numbers that aren't Bangladeshi mobiles", async () => {
    const res = await sendOtp("12345");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/valid Bangladeshi mobile/);
  });

  it("sends a code (shown as dev_otp outside production) and throttles resends", async () => {
    const res = await sendOtp("01712345678");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ phone_number: "01712345678", expires_in: 300, resend_in: 60 });
    expect(res.body.data.dev_otp).toMatch(/^\d{6}$/);

    // The database only has the hash.
    const saved = await prisma.otpCode.findFirstOrThrow({ where: { phone: "01712345678" } });
    expect(saved.code_hash).not.toContain(res.body.data.dev_otp);

    const again = await sendOtp("+880 1712-345678"); // same number, other format
    expect(again.status).toBe(429);
    expect(again.body.message).toMatch(/Please wait \d+ seconds/);
  });

  it("refuses wrong and expired codes", async () => {
    await skipResendWait("01712345678");
    const { dev_otp } = (await sendOtp("01712345678")).body.data;

    const wrong = await verifyOtp("01712345678", dev_otp === "000000" ? "111111" : "000000");
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toMatch(/Wrong code\. 4 attempt\(s\) left/);

    await prisma.otpCode.updateMany({ where: { phone: "01712345678" }, data: { expires_at: new Date(0) } });
    const expired = await verifyOtp("01712345678", dev_otp);
    expect(expired.status).toBe(400);
    expect(expired.body.message).toMatch(/expired/);
  });

  it("logs in, creates the account once (named after the last order) and links past orders", async () => {
    await skipResendWait("01712345678");
    const { dev_otp } = (await sendOtp("01712345678")).body.data;

    const res = await verifyOtp("8801712345678", dev_otp); // any format works
    expect(res.status).toBe(200);
    expect(res.body.data.access_token).toBeTruthy();
    expect(res.body.data.user).toMatchObject({ full_name: "Rahim Uddin", phone_number: "01712345678" });
    expect(res.body.data.user.password).toBeUndefined();
    customerToken = res.body.data.access_token;

    // A code works only once.
    expect((await verifyOtp("01712345678", dev_otp)).status).toBe(400);

    const user = await prisma.user.findFirstOrThrow({ where: { phone_number: "01712345678" } });
    expect(user).toMatchObject({ role: "USER", userType: "CUSTOMER" });
    const linked = await prisma.order.count({ where: { user_id: user.id } });
    expect(linked).toBe(1);
  });

  it("shows only the customer's own orders, with a payment status", async () => {
    const mine = await api().get("/api/v1/order/customer/my-order").set(auth(customerToken));
    expect(mine.status).toBe(200);
    expect(mine.body.data.data).toHaveLength(1);
    expect(mine.body.data.data[0]).toMatchObject({
      status: "PLACED",
      payment_status: "UNPAID",
      total_amount: 1080,
    });
    expect(mine.body.data.data[0].products[0].product.name).toBe("Wallet");
    expect(mine.body.data.data[0].admin_notes).toBeUndefined(); // no internal data

    const someoneElses = await prisma.order.findFirstOrThrow({ where: { customer_phone: "01811111111" } });
    expect(
      (await api().get(`/api/v1/customer/orders/${someoneElses.id}`).set(auth(customerToken))).status
    ).toBe(404);

    // New orders are saved as 01XXXXXXXXX.
    expect(someoneElses.customer_phone).toBe("01811111111");
    const rahims = await prisma.order.findFirstOrThrow({ where: { customer_name: "Rahim Uddin" } });
    expect(rahims.customer_phone).toBe("01712345678");
  });

  it("updates the profile and keeps customer and staff tokens apart", async () => {
    const updated = await api()
      .patch("/api/v1/customer/me")
      .set(auth(customerToken))
      .send({ full_name: "Rahim U.", email: "rahim@example.com" });
    expect(updated.body.data).toMatchObject({ full_name: "Rahim U.", email: "rahim@example.com" });

    expect((await api().get("/api/v1/customer/me")).status).toBe(401);
    expect((await api().get("/api/v1/customer/me").set(auth(adminToken))).status).toBe(403);
    expect((await api().get("/api/v1/order").set(auth(customerToken))).status).toBe(403); // admin list
  });

  it("locks a code after 5 wrong attempts and refuses staff numbers", async () => {
    await skipResendWait("01712345678");
    const { dev_otp } = (await sendOtp("01712345678")).body.data;
    const wrongCode = dev_otp === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) expect((await verifyOtp("01712345678", wrongCode)).status).toBe(400);
    expect((await verifyOtp("01712345678", wrongCode)).status).toBe(429);
    expect((await verifyOtp("01712345678", dev_otp)).status).toBe(429); // even the right code now

    const staffCode = (await sendOtp("01700000000")).body.data.dev_otp; // seeded super admin
    const staff = await verifyOtp("01700000000", staffCode);
    expect(staff.status).toBe(403);
    expect(staff.body.message).toMatch(/staff account/);
  });
});
