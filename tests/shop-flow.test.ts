import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, prisma, resetDb, seedBasics } from "./helpers";

/** Storefront checkout → admin processing, with stock checked at every step. */
describe("shop flow", () => {
  let token: string;
  let productId: string;
  let variantId: string;
  let stockId: string;
  let warehouseId: string;

  const available = async () =>
    (await api().get(`/api/v1/stocks/${productId}/${variantId}`)).body.data.totalAvailableQuantity;
  const reserved = async () =>
    (await prisma.stock.findUniqueOrThrow({ where: { id: stockId } })).reserved_quantity;
  const order = (qty: number, total: number, extra: object = {}) =>
    api()
      .post("/api/v1/order")
      .send({
        customer_name: "Test Buyer",
        customer_phone: "01911111111",
        payment_type: "CASH_ON_DELIVERY",
        delivery_charge: 80,
        total_amount: total,
        delivery_address: { division: "Dhaka", district: "Dhaka", thana: "Gulshan", address: "House 1" },
        products: [{ product: productId, total_quantity: qty, selected_variant: { _id: variantId } }],
        ...extra,
      });
  const setStatus = (id: string, status: string) =>
    api().patch(`/api/v1/order/${id}/status`).set(auth(token)).send({ status });

  beforeAll(async () => {
    await resetDb();
    const basics = await seedBasics();
    ({ token, warehouseId } = basics);
    const p = await api()
      .post("/api/v1/product")
      .set(auth(token))
      .send({
        name: "Sneaker",
        category: basics.categoryId,
        sku: "SNK",
        variantsCombination: [{ regular_price: 4200, sale_price: 3800 }],
      });
    productId = p.body.data._id;
    variantId = p.body.data.variants[0]._id;
    const rows = await api().get(`/api/v1/stocks?sku=SNK&businessLocationId=${warehouseId}`).set(auth(token));
    stockId = rows.body.data.data[0]._id;
    const adj = await api()
      .post("/api/v1/stocks/adjustment")
      .set(auth(token))
      .send({
        business_location: warehouseId,
        action: "ADDITION",
        products: [{ stock: stockId, quantity: 10 }],
      });
    expect(adj.status).toBe(201);
  });

  it("starts with the added stock and an adjustment history entry", async () => {
    expect(await available()).toBe(10);
    const hist = await api().get("/api/v1/stocks/adjustment").set(auth(token));
    expect(hist.body.meta.total).toBe(1);
    expect(hist.body.data[0].adjust_by.full_name).toBe("Super Admin");
    expect(hist.body.data[0].products[0].product.name).toBe("Sneaker");
  });

  it("validates orders on the server", async () => {
    expect((await order(2, 999)).status).toBe(409); // stale total
    expect((await order(11, 11 * 3800 + 80)).body.message).toMatch(/Only 10 left/);
    expect((await order(1, 3880, { delivery_charge: 5 })).status).toBe(400); // unknown delivery rate
    expect((await order(1, 3880, { payment_type: "FULL_PAYMENT" })).status).toBe(400); // no payment proof
    expect((await order(1, 3880, { coupon: "X" })).status).toBe(400);
    expect(await available()).toBe(10); // nothing reserved by failed attempts
  });

  it("places an order, reserves stock, and moves it through fulfilment", async () => {
    const res = await order(2, 7680);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      order_serial_id: 1001,
      invoice_number: "INV-1001",
      total_amount: 7680,
      sub_total: 7600,
      COD: 7680,
    });
    const id = res.body.data._id;
    expect(await available()).toBe(8);
    expect(await reserved()).toBe(2);

    const list = await api().get("/api/v1/order?page=1&limit=20").set(auth(token));
    expect(list.body.data.meta.status_total).toMatchObject({ all: 1, placed: 1 });
    const details = await api().get(`/api/v1/order/${id}`).set(auth(token));
    expect(details.body.data.products[0].selected_variant._id).toBe(variantId);
    expect(details.body.data.stock_allocations).toBeUndefined();

    await api().patch(`/api/v1/order/${id}/mark-called`).set(auth(token));
    await api().put(`/api/v1/order/admin-note/${id}`).set(auth(token)).send({ note: "Confirmed" });
    expect((await setStatus(id, "IN_REVIEW")).body.data.status_history[1].changed_by.full_name).toBe(
      "Super Admin"
    );

    await setStatus(id, "HANDED_OVER_TO_COURIER");
    expect(await reserved()).toBe(0); // shipped
    expect(await available()).toBe(8);

    const delivered = await api().patch(`/api/v1/order/${id}/mark-delivered`).set(auth(token));
    expect(delivered.body.data.paid_amount).toBe(7680);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).total_sold).toBe(2);

    await setStatus(id, "RETURNED");
    expect(await available()).toBe(10); // back on the shelf
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).total_sold).toBe(0);

    const track = await api().get("/api/v1/order/track-by-sl/INV-1001");
    expect(track.body.data.status).toBe("RETURNED");
    expect(track.body.data.customer_phone).toBeUndefined(); // no personal data on the public endpoint
  });

  it("releases stock when an order is cancelled or deleted", async () => {
    const a = (await order(3, 3 * 3800 + 80)).body.data._id;
    const b = (await order(1, 3880)).body.data._id;
    expect(await available()).toBe(6);
    await setStatus(a, "CANCELLED");
    expect(await available()).toBe(9);
    await api().delete(`/api/v1/order/${b}`).set(auth(token));
    expect(await available()).toBe(10);
    expect(await reserved()).toBe(0);
  });

  it("never oversells under concurrent checkouts", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => order(3, 3 * 3800 + 80)));
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(3); // 10 units → only three orders of 3 fit
    expect(await available()).toBe(1);
    expect(await reserved()).toBe(9);
  });
});
