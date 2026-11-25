import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/** SMS providers (HTTP mocked — nothing is sent). */
const http = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock("axios", () => ({ default: http }));

describe("sendSms", () => {
  let sendSms: (to: string, message: string) => Promise<boolean>;
  let config: { sms?: { provider: string; apiKey: string; senderId?: string; baseUrl: string } };

  beforeAll(async () => {
    process.env.SMS_PROVIDER = "alpha";
    process.env.SMS_API_KEY = "key";
    process.env.SMS_SENDER_ID = "";
    process.env.SMS_BASE_URL = "";
    ({ sendSms } = await import("@/helpers/smsSender"));
    config = (await import("@/config")).default as typeof config;
  });

  afterEach(() => vi.clearAllMocks());

  it("Alpha SMS: posts api_key / to / msg (non-masking, no sender id)", async () => {
    http.post.mockResolvedValue({ data: { error: 0, msg: "Request successfully submitted" } });

    expect(await sendSms("01712345678", "123456 is your code")).toBe(true);
    const [url, body] = http.post.mock.calls[0];
    expect(url).toBe("https://api.sms.net.bd/sendsms");
    expect(Object.fromEntries(body)).toEqual({
      api_key: "key",
      to: "8801712345678",
      msg: "123456 is your code",
    });
  });

  it("Alpha SMS: an error code (e.g. 417 low balance) returns false, never throws", async () => {
    http.post.mockResolvedValue({ data: { error: 417, msg: "Insufficient balance" } });
    expect(await sendSms("01712345678", "hi")).toBe(false);

    http.post.mockRejectedValue(new Error("timeout"));
    expect(await sendSms("01712345678", "hi")).toBe(false);
  });

  it("BulkSMSBD: still works when SMS_PROVIDER=bulksmsbd", async () => {
    config.sms = {
      provider: "bulksmsbd",
      apiKey: "key",
      senderId: "8809617",
      baseUrl: "http://bulksmsbd.net/api/smsapi",
    };
    http.get.mockResolvedValue({ data: { response_code: 202 } });

    expect(await sendSms("+8801712345678", "hi")).toBe(true);
    expect(http.get.mock.calls[0][1].params).toMatchObject({ senderid: "8809617", number: "8801712345678" });
  });
});
