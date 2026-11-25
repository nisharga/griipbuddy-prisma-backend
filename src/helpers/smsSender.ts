import axios from "axios";
import config from "@/config";
import { logger } from "@/shared/logger";

/**
 * Sends one SMS through the provider in SMS_PROVIDER:
 *   alpha      → Alpha SMS (api.sms.net.bd), success = { error: 0 }
 *   bulksmsbd  → BulkSMSBD,                  success = { response_code: 202 }
 *
 * SMS off (no SMS_API_KEY) → skipped and logged.
 * Never throws: an SMS failure must not break the order or login that triggered it.
 */

/** "01712345678" / "+8801712345678" → "8801712345678". */
const toInternational = (phone: string) => phone.replace(/\D/g, "").replace(/^0/, "880");

/** Alpha SMS: https://www.alpha.net.bd/SMS/api/ */
const sendWithAlpha = async (to: string, message: string): Promise<unknown> => {
  const sms = config.sms!;
  const body = new URLSearchParams({ api_key: sms.apiKey, to: toInternational(to), msg: message });
  if (sms.senderId) body.set("sender_id", sms.senderId); // only for an approved masking name

  const { data } = await axios.post(sms.baseUrl, body, { timeout: 10_000 });
  return Number(data?.error) === 0 ? null : data;
};

/** BulkSMSBD: http://bulksmsbd.net/api/smsapi */
const sendWithBulkSmsBd = async (to: string, message: string): Promise<unknown> => {
  const sms = config.sms!;
  const params = { api_key: sms.apiKey, senderid: sms.senderId, number: toInternational(to), message };

  const { data } = await axios.get(sms.baseUrl, { params, timeout: 10_000 });
  return Number(data?.response_code) === 202 ? null : data;
};

export const sendSms = async (to: string, message: string): Promise<boolean> => {
  if (!config.sms) {
    logger.debug({ to }, "sms skipped (not configured)");
    return false;
  }

  try {
    const send = config.sms.provider === "alpha" ? sendWithAlpha : sendWithBulkSmsBd;
    const rejected = await send(to, message); // null = sent, otherwise the provider's reply

    if (rejected) {
      logger.warn({ to, provider: config.sms.provider, response: rejected }, "sms rejected by provider");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ to, provider: config.sms.provider, err: (err as Error).message }, "sms failed");
    return false;
  }
};
