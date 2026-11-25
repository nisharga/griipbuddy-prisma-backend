import { beforeAll, describe, expect, it } from "vitest";
import { api, resetDb, seedBasics } from "./helpers";

let token = "";
const get = (url: string) =>
  api()
    .get(url)
    .set({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  await resetDb();
  token = (await seedBasics()).token;
});

describe("query string checks", () => {
  it.each([
    ["/api/v1/order?limit=abc", "limit must be a whole number"],
    ["/api/v1/order?limit=5000", "limit must be between 1 and 1000"],
    ["/api/v1/order?page=0", "page must be between 1 and 100000"],
    ["/api/v1/order?page=1&page=2", "page must be sent once"],
    ["/api/v1/order?sortOrder=sideways", "sortOrder must be asc or desc"],
    ["/api/v1/order?startDate=yesterday", "startDate must be a date like 2024-12-31"],
    ["/api/v1/order?startDate=2024-02-30", "startDate is not a real date"],
    ["/api/v1/product?min_price=abc", "min_price must be a number"],
    ["/api/v1/order?searchTerm[a]=1", "searchTerm must be text"],
  ])("%s → 400", async (url, message) => {
    const res = await get(url);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
  });

  it("accepts good values and empty filters", async () => {
    const ok = await get(
      "/api/v1/order?page=1&limit=20&sortBy=createdAt&sortOrder=asc&startDate=2024-01-01&endDate=2024-12-31"
    );
    expect(ok.status).toBe(200);
    expect(ok.body.data.meta).toMatchObject({ page: 1, limit: 20 });

    const blanks = await get("/api/v1/order?page=&limit=undefined&searchTerm=&startDate=null");
    expect(blanks.status).toBe(200);
  });
});

describe("id checks", () => {
  it("a bad id is a 400", async () => {
    const res = await get("/api/v1/brand/not-an-id");
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid id.");

    const stock = await api().get("/api/v1/stocks/abc/cmh3k2x1p0000abcd1234efgh");
    expect(stock.status).toBe(400);
    expect(stock.body.message).toBe("Invalid productId.");
  });

  it("a well-formed id that doesn't exist is still a 404", async () => {
    const res = await get("/api/v1/brand/cmh3k2x1p0000abcd1234efgh");
    expect(res.status).toBe(404);
  });

  it("slugs are not checked as ids", async () => {
    const res = await api().get("/api/v1/product/slug/some-product");
    expect(res.status).toBe(404);
  });
});
