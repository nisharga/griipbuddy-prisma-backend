import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { buildOpenApi, unknownEndpointKeys } from "../swagger/build";

/** swagger/openapi.json must match the routes. If this fails: run `npm run docs` and commit the file. */
describe("API docs (swagger/openapi.json)", () => {
  const built = buildOpenApi();

  it("is up to date with the routes and schemas", () => {
    const file = path.join(__dirname, "..", "swagger", "openapi.json");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(saved, "swagger/openapi.json is out of date — run `npm run docs`").toEqual(
      JSON.parse(JSON.stringify(built))
    );
  });

  it("swagger/endpoints.ts only describes routes that exist", () => {
    expect(unknownEndpointKeys(built)).toEqual([]);
  });

  it("documents auth and request bodies from the code", () => {
    const verify = built.paths["/customer/otp/verify"].post as Record<string, unknown>;
    expect(verify.security).toBeUndefined(); // public
    expect(JSON.stringify(verify.requestBody)).toContain('"otp"');

    const changeStatus = built.paths["/order/{id}/status"].patch as Record<string, unknown>;
    expect(changeStatus.security).toEqual([{ bearerAuth: [] }]);
    expect(changeStatus.description).toContain("`order.update`");
  });
});
