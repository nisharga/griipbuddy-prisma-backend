import { describe, expect, it } from "vitest";
import { filterWhere, NEWEST_FIRST, paginate, searchWhere, sortBy } from "@/helpers/queryBuilder";
import type { IPagination } from "@/interfaces/pagination";

const page = (extra: Partial<IPagination> = {}): IPagination => ({
  page: 2,
  limit: 10,
  skip: 10,
  sortOrder: "desc",
  ...extra,
});

describe("queryBuilder", () => {
  it("searchWhere: one text over several fields, dotted paths reach relations", () => {
    expect(searchWhere(undefined, ["name"])).toEqual({});
    expect(searchWhere("shoe", ["name", "product.sku"])).toEqual({
      OR: [
        { name: { contains: "shoe", mode: "insensitive" } },
        { product: { sku: { contains: "shoe", mode: "insensitive" } } },
      ],
    });
  });

  it("filterWhere: keeps only filters that have a value", () => {
    expect(
      filterWhere({ status: "active", supplier_id: undefined, type: "", note: null, is_called: false })
    ).toEqual({
      status: "active",
      is_called: false,
    });
  });

  it("sortBy: uses the client's field only when it's allowed", () => {
    expect(sortBy(page({ sortBy: "name", sortOrder: "asc" }), ["name", "createdAt"], NEWEST_FIRST)).toEqual({
      name: "asc",
    });
    expect(sortBy(page({ sortBy: "password" }), ["name", "createdAt"], NEWEST_FIRST)).toEqual(NEWEST_FIRST);
    expect(sortBy(page(), ["name"], NEWEST_FIRST)).toEqual(NEWEST_FIRST);
  });

  it("paginate: passes skip/take and builds meta", async () => {
    let received: unknown;
    const result = await paginate(page(), {
      findMany: async (p) => {
        received = p;
        return ["a", "b"];
      },
      count: async () => 25,
    });
    expect(received).toEqual({ skip: 10, take: 10 });
    expect(result).toEqual({ data: ["a", "b"], meta: { page: 2, limit: 10, total: 25, totalPage: 3 } });
  });
});
