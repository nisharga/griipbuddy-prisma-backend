import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, resetDb, seedBasics } from "./helpers";

describe("catalog", () => {
  let token: string;
  let categoryId: string;
  let subId: string;
  beforeAll(async () => {
    await resetDb();
    ({ token, categoryId, subId } = await seedBasics());
  });

  it("serves categories publicly, hiding unpublished ones from shoppers", async () => {
    const hidden = await api()
      .post("/api/v1/category")
      .set(auth(token))
      .send({ name_en: "Hidden", is_published: false });
    expect(hidden.status).toBe(201);
    const shopper = await api().get("/api/v1/category").set({ Authorization: "Bearer undefined" });
    expect(shopper.body.data.data.map((c: { name_en: string }) => c.name_en)).toEqual(["Footwear"]);
    expect(shopper.body.data.data[0].subcategories[0].name_en).toBe("Sneakers");
    const admin = await api().get("/api/v1/category").set(auth(token));
    expect(admin.body.data.meta.total).toBe(2);
    // Storefront navbar: published only — even for a staff token — with sub-categories.
    const published = await api().get("/api/v1/category/published/all").set(auth(token));
    expect(published.body.data.data.map((c: { name_en: string }) => c.name_en)).toEqual(["Footwear"]);
    expect(published.body.data.data[0].subcategories[0].name_en).toBe("Sneakers");
    expect((await api().post("/api/v1/category").send({ name_en: "x" })).status).toBe(401);
  });

  it("handles sub-sub-categories and their lookups", async () => {
    const child = await api()
      .post("/api/v1/sub-category/sub-subcategory/create")
      .set(auth(token))
      .send({ name_en: "Running", subcategory: subId });
    expect(child.status).toBe(201);
    expect(child.body.data).toMatchObject({ category: categoryId, subcategory: subId });

    const bySub = await api().get(`/api/v1/sub-category/sub-subcategory/by-subcategory-id/${subId}`);
    expect(bySub.body.data.sub_subcategories).toHaveLength(1);
    const list = await api().get("/api/v1/sub-category");
    expect(list.body.data.subcategories[0].category.name_en).toBe("Footwear");
    expect((await api().delete(`/api/v1/category/${categoryId}`).set(auth(token))).status).toBe(400);
  });

  it("creates a product with variants, auto SKUs/barcodes and stock rows", async () => {
    const res = await api()
      .post("/api/v1/product")
      .set(auth(token))
      .send({
        name: "Runner",
        category: categoryId,
        subcategory: subId,
        brand: "",
        sku: "RUN-1",
        attributes: ["Size"],
        variantsCombination: [
          { attribute_values: { Size: "41" }, regular_price: 1000, sale_price: 900 },
          { attribute_values: { Size: "42" }, regular_price: 1000, sale_price: 950 },
        ],
      });
    expect(res.status).toBe(201);
    const p = res.body.data;
    expect(p.variants.map((v: { sku: string }) => v.sku)).toEqual(["RUN-1-1", "RUN-1-2"]);
    expect(p.variants[0].barcode).toMatch(/^\d{12}$/);
    expect(p.variants[0].sale_price).toBe(900); // Decimal → number
    expect(p.category._id).toBe(categoryId);
    expect(p.brand).toBeNull();

    expect(
      (
        await api()
          .post("/api/v1/product")
          .set(auth(token))
          .send({ name: "Runner", category: categoryId, sku: "RUN-1" })
      ).status
    ).toBe(409);

    const stocks = await api().get(`/api/v1/stocks?sku=RUN-1`).set(auth(token));
    expect(stocks.body.data.meta.total).toBe(2);

    // Public listing sorted by price, collection by slug, product page.
    const list = await api().get("/api/v1/product?sortBy=price&sortOrder=asc");
    expect(list.body.data.products[0].slug).toBe("runner");
    expect((await api().get("/api/v1/product?subcategory=sneakers")).body.data.meta.total).toBe(1);
    const page = await api().get("/api/v1/product/slug/runner");
    expect(page.body.data.product.variants).toHaveLength(2);

    // Variant upsert + publish toggle + soft delete.
    const upd = await api()
      .patch(`/api/v1/product/variant/${p._id}`)
      .set(auth(token))
      .send({
        attributes: ["Size"],
        variants: [
          {
            _id: p.variants[0]._id,
            attribute_values: { Size: "41" },
            sale_price: 800,
            regular_price: 1000,
            sku: "RUN-1-1",
          },
          { attribute_values: { Size: "43" }, sale_price: 990, regular_price: 1000 },
        ],
      });
    expect({ status: upd.status, message: upd.body.message }).toEqual({
      status: 200,
      message: "Variants updated successfully.",
    });
    expect(upd.body.data.variants).toHaveLength(3);
    expect(
      (
        await api()
          .patch(`/api/v1/product/admin/publish/${p._id}`)
          .set(auth(token))
          .send({ is_published: false })
      ).body.data.is_published
    ).toBe(false);
    expect((await api().get("/api/v1/product/slug/runner")).status).toBe(404);
    expect((await api().delete(`/api/v1/product/${p._id}`).set(auth(token))).status).toBe(200);
    // A category whose only products were deleted can be removed.
    await api()
      .delete(
        `/api/v1/sub-category/sub-subcategory/${(await api().get(`/api/v1/sub-category/sub-subcategory/by-subcategory-id/${subId}`)).body.data.sub_subcategories[0]._id}`
      )
      .set(auth(token));
    expect((await api().delete(`/api/v1/sub-category/${subId}`).set(auth(token))).status).toBe(200);
    expect((await api().delete(`/api/v1/category/${categoryId}`).set(auth(token))).status).toBe(200);
  });

  it("supports brands, return policies and suppliers with the admin's shapes", async () => {
    await api()
      .post("/api/v1/brand")
      .set(auth(token))
      .send({ name: "Acme", tags: ["a"] });
    expect((await api().get("/api/v1/brand/all").set(auth(token))).body.data).toHaveLength(1);
    expect((await api().get("/api/v1/brand/admin/all").set(auth(token))).body.data.brands).toHaveLength(1);

    await api()
      .post("/api/v1/return-policy")
      .set(auth(token))
      .send({ title: "7 Days", description: "d", return_period_days: 7 });
    expect((await api().get("/api/v1/return-policy/public").set(auth(token))).body.data.data).toHaveLength(1);

    const s = await api().post("/api/v1/supplier").set(auth(token)).send({
      name: "Hides Ltd",
      contact_id: "SUP-1",
      address: "Hazaribagh, Dhaka",
      phone: "01712345678",
      default_payment_terms: "NET_30",
      type: "COMPANY",
    });
    expect(s.body.data.contact_id).toBe("SUP-1"); // a real field, not a foreign key
    const list = await api().get("/api/v1/supplier").set(auth(token));
    expect(Array.isArray(list.body.data)).toBe(true);
    expect(list.body.meta.total).toBe(1);
  });
});
