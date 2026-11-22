import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cloudinary storage (SDK mocked — no network, no real account needed).
 * Credentials are set before the app config is loaded so Cloudinary is the
 * active storage for this file.
 */
const calls = vi.hoisted(() => ({
  options: [] as Record<string, unknown>[],
  method: [] as string[],
  config: undefined as Record<string, unknown> | undefined,
  fail: false,
}));

vi.mock("cloudinary", () => {
  const stream = (method: string) => (options: Record<string, unknown>, cb: (err?: unknown, res?: unknown) => void) => {
    calls.method.push(method);
    calls.options.push(options);
    return {
      end: (buffer: Buffer) =>
        calls.fail
          ? cb({ message: "Invalid api_key" })
          : cb(undefined, {
              secure_url: `https://res.cloudinary.com/demo/image/upload/v1/${String(options.folder)}/${String(options.public_id)}.jpg`,
              bytes: buffer.length,
            }),
    };
  };
  return {
    v2: {
      config: (c: Record<string, unknown>) => (calls.config = c),
      uploader: { upload_stream: stream("upload_stream"), upload_chunked_stream: stream("upload_chunked_stream") },
    },
  };
});

const file = (size: number, name = "photo.jpg") =>
  ({ originalname: name, mimetype: "image/jpeg", size, buffer: Buffer.alloc(Math.min(size, 16)) }) as Express.Multer.File;

describe("file storage → Cloudinary", () => {
  let saveFile: (f: Express.Multer.File, folder: string) => Promise<string>;

  beforeAll(async () => {
    process.env.CLOUDINARY_CLOUD_NAME = "demo";
    process.env.CLOUDINARY_API_KEY = "key";
    process.env.CLOUDINARY_API_SECRET = "secret";
    process.env.CLOUDINARY_FOLDER = "/shop/";
    ({ saveFile } = await import("@/helpers/fileStorage"));
  });

  beforeEach(() => {
    calls.options.length = 0;
    calls.method.length = 0;
    calls.fail = false;
  });

  it("uploads into <folder>/<kind> and returns the https link", async () => {
    const url = await saveFile(file(1024), "images");
    expect(url).toMatch(/^https:\/\/res\.cloudinary\.com\/demo\/image\/upload\/v1\/shop\/images\/[0-9a-f-]{36}\.jpg$/);
    expect(calls.method).toEqual(["upload_stream"]);
    expect(calls.options[0]).toMatchObject({ folder: "shop/images", resource_type: "auto" });
    expect(calls.config).toMatchObject({ cloud_name: "demo", api_key: "key", secure: true });
  });

  it("sends large files (videos) in chunks", async () => {
    await saveFile(file(50 * 1024 * 1024, "clip.mp4"), "videos");
    expect(calls.method).toEqual(["upload_chunked_stream"]);
    expect(calls.options[0]).toMatchObject({ folder: "shop/videos", chunk_size: 20 * 1024 * 1024 });
  });

  it("turns a Cloudinary failure into a 502 with a friendly message", async () => {
    calls.fail = true;
    await expect(saveFile(file(10), "images")).rejects.toMatchObject({
      statusCode: 502,
      message: "Couldn't upload the file right now. Please try again.",
    });
  });
});
