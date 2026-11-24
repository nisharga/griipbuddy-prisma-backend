import fs from "fs/promises";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { api as apiHelper } from "./helpers";

/** Uploads return only a short path ("uploads/<id>.jpg"); the frontend adds the base URL. */
describe("file upload → local disk", () => {
  let api: typeof apiHelper;
  const saved: string[] = [];

  beforeAll(async () => {
    // Force local disk even if .env has Cloudinary / S3 set.
    for (const key of ["CLOUDINARY_CLOUD_NAME", "AWS_ACCESS_KEY_ID", "AWS_BUCKET_NAME"])
      process.env[key] = "";
    ({ api } = await import("./helpers"));
  });

  afterAll(async () => {
    await Promise.all(saved.map((file) => fs.rm(path.join(process.cwd(), file), { force: true })));
  });

  it("returns uploads/<id>.<ext> and serves the file at that path", async () => {
    const image = Buffer.from("fake-png-bytes");
    const res = await api()
      .post("/api/v1/upload/payment-proof")
      .attach("file", image, { filename: "Proof.PNG", contentType: "image/png" });

    expect(res.status).toBe(200);
    const url: string = res.body.data.url;
    expect(url).toMatch(/^uploads\/[0-9a-f-]{36}\.png$/);
    saved.push(url);

    const served = await api().get(`/${url}`);
    expect(served.status).toBe(200);
    expect(Buffer.from(served.body).toString()).toBe("fake-png-bytes");
  });
});
