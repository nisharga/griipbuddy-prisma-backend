import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, prisma, resetDb, seedBasics } from "./helpers";

describe("product FAQs", () => {
  let token: string;
  let productId: string;
  beforeAll(async () => {
    await resetDb();
    ({ token } = await seedBasics());
    const product = await prisma.product.create({
      data: { name: "Runner", slug: "runner", sku: "RUN-1", thumbnail: "runner.jpg" },
    });
    productId = product.id;
  });

  it("customer asks → admin answers → storefront shows it", async () => {
    const asked = await api()
      .post("/api/v1/faq/public")
      .send({ product: productId, question: "Is it waterproof?", createdBy: "Rahim", email: "" });
    expect(asked.status).toBe(201);
    expect(asked.body.data.status).toBe("pending");
    const id = asked.body.data._id as string;

    // pending questions stay hidden on the storefront
    expect((await api().get("/api/v1/faq/public/product/runner")).body.data.faqs).toHaveLength(0);

    const list = await api().get("/api/v1/faq/admin/all").set(auth(token));
    expect(list.body.data.faqs[0]).toMatchObject({ _id: id, product: { name: "Runner", sku: "RUN-1" } });
    expect(list.body.data.meta.total).toBe(1);

    const one = await api().get(`/api/v1/faq/${id}`).set(auth(token));
    expect(one.body.data).toMatchObject({ question: "Is it waterproof?", product: { slug: "runner" } });

    const answered = await api()
      .patch(`/api/v1/faq/admin/public-faq-action/${id}`)
      .set(auth(token))
      .send({ status: "active", answer: "Yes, fully." });
    expect(answered.status).toBe(200);

    const shown = await api().get("/api/v1/faq/public/product/runner");
    expect(shown.body.data.faqs).toMatchObject([{ question: "Is it waterproof?", answer: "Yes, fully." }]);

    expect((await api().delete(`/api/v1/faq/admin/${id}`).set(auth(token))).status).toBe(200);
    expect((await api().get(`/api/v1/faq/${id}`).set(auth(token))).status).toBe(404);
  });

  it("admin creates FAQs; admin routes need a token; input is validated", async () => {
    const created = await api()
      .post("/api/v1/faq/admin")
      .set(auth(token))
      .send({ product: productId, question: "Warranty?", answer: "1 year", status: "active" });
    expect(created.status).toBe(201);
    expect(created.body.data.createdBy).toBe("Super Admin");

    expect((await api().get("/api/v1/faq/admin/all")).status).toBe(401);
    expect((await api().post("/api/v1/faq/public").send({ product: productId, question: "" })).status).toBe(
      400
    );
    expect(
      (await api().post("/api/v1/faq/public").send({ product: "nope", question: "Hello?" })).status
    ).toBe(404);
  });
});
