import axios from "axios";
import config from "@/config";
import { logger } from "@/shared/logger";

/**
 * BulkSMSBD sender. A no-op (logged) when SMS_API_KEY / SMS_SENDER_ID are unset.
 * Never throws: an SMS failure must not break the order that triggered it.
 */
export const sendSms = async (to: string, message: string): Promise<boolean> => {
  if (!config.sms) {
    logger.debug({ to }, "sms skipped (not configured)");
    return false;
  }
  try {
    const number = to.replace(/\D/g, "").replace(/^0/, "880");
    const { data } = await axios.get(config.sms.baseUrl, {
      params: { api_key: config.sms.apiKey, senderid: config.sms.senderId, number, message },
      timeout: 10_000,
    });
    const ok = Number(data?.response_code) === 202;
    if (!ok) logger.warn({ to, response: data }, "sms rejected by provider");
    return ok;
  } catch (err) {
    logger.error({ to, err: (err as Error).message }, "sms failed");
    return false;
  }
};
