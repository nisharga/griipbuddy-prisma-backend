import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, resetDb, seedBasics } from "./helpers";

describe("storefront random product feed", () => {
  const published: string[] = [];

  beforeAll(async () => {
    await resetDb();
    const { token, categoryId } = await seedBasics();
    for (const n of [1, 2, 3, 4]) {
      const res = await api()
        .post("/api/v1/product")
        .set(auth(token))
        .send({
          name: `Feed ${n}`,
          category: categoryId,
          sku: `FEED-${n}`,
          attributes: ["Size"],
          variantsCombination: [{ attribute_values: { Size: "M" }, regular_price: 500, sale_price: 450 }],
        });
      expect(res.status).toBe(201);
      if (n === 4) {
        await api()
          .patch(`/api/v1/product/admin/publish/${res.body.data._id}`)
          .set(auth(token))
          .send({ is_published: false });
      } else published.push(res.body.data._id);
    }
  });

  it("pages through every published product once, in a stable order", async () => {
    const first = await api().get("/api/v1/product/public/random?page=1&limit=2");
    expect(first.status).toBe(200);
    // The infinite scroll reads data.products and the top-level meta.total_pages.
    expect(first.body.meta).toMatchObject({ total: 3, total_pages: 2 });
    expect(first.body.data.products[0].variants[0]).toMatchObject({ regular_price: 500, sale_price: 450 });

    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = await api().get(`/api/v1/product/public/random?page=${page}&limit=2`);
      seen.push(...res.body.data.products.map((p: { _id: string }) => p._id));
    }
    expect(seen).toHaveLength(3);
    expect(new Set(seen)).toEqual(new Set(published)); // no repeats, nothing unpublished

    const again = await api().get("/api/v1/product/public/random?page=1&limit=2");
    expect(again.body.data.products.map((p: { _id: string }) => p._id)).toEqual(
      first.body.data.products.map((p: { _id: string }) => p._id)
    );
  });
});
