import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/** Error tracking: what is (and isn't) sent to Sentry. The SDK is mocked — nothing leaves the machine. */
const sentry = vi.hoisted(() => {
  const scope = { setTags: vi.fn(), setExtras: vi.fn(), setUser: vi.fn() };
  return {
    scope,
    captureException: vi.fn(),
    withScope: vi.fn((callback: (s: typeof scope) => void) => callback(scope)),
    init: vi.fn(),
    close: vi.fn(async () => true),
  };
});
vi.mock("@sentry/node", () => sentry);

import config from "@/config";
import { scrub } from "@/shared/sentry";
import { ADMIN, api, prisma, resetDb, seedBasics } from "./helpers";

describe("Sentry error reports", () => {
  const settings = config as { sentry?: unknown };

  beforeAll(async () => {
    await resetDb();
    await seedBasics();
    settings.sentry = { dsn: "https://key@o0.ingest.sentry.io/0", environment: "test", tracesSampleRate: 0 };
  });
  afterEach(() => {
    vi.restoreAllMocks();
    sentry.captureException.mockClear();
    sentry.scope.setExtras.mockClear();
  });
  afterAll(() => {
    settings.sentry = undefined;
  });

  it("reports a 500 with route, user and request info", async () => {
    vi.spyOn(prisma.heroSlide, "findMany").mockRejectedValue(new Error("database is down"));

    const res = await api().get("/api/v1/cms/hero-section");
    expect(res.status).toBe(500);
    expect(res.body.message).toBe("Something went wrong. Please try again."); // details never reach the client

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect((sentry.captureException.mock.calls[0][0] as Error).message).toBe("database is down");
    expect(sentry.scope.setTags).toHaveBeenCalledWith({ method: "GET", route: "/hero-section" });
  });

  it("does not report normal 4xx errors (not found, bad input, wrong password)", async () => {
    await api().get("/api/v1/does-not-exist");
    await api().post("/api/v1/customer/otp/send").send({ phone_number: "123" });
    await api()
      .post("/api/v1/user/admin/login")
      .send({ ...ADMIN, password: "wrong" });
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("never sends passwords, codes or tokens", async () => {
    vi.spyOn(prisma.user, "findFirst").mockRejectedValue(new Error("boom"));
    await api()
      .post("/api/v1/user/admin/login")
      .send({ phone_number: ADMIN.phone_number, password: "Secret@123" });

    const extra = sentry.scope.setExtras.mock.calls[0][0] as { body: Record<string, unknown> };
    expect(extra.body).toEqual({ phone_number: ADMIN.phone_number, password: "[removed]" });

    expect(
      scrub({
        otp: "123456",
        refresh_token: "t",
        nested: { new_password: "x", statusCode: 500 },
        title: "ok",
      })
    ).toEqual({
      otp: "[removed]",
      refresh_token: "[removed]",
      nested: { new_password: "[removed]", statusCode: 500 },
      title: "ok",
    });
  });
});
