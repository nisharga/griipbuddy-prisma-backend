import { createHmac, randomInt, timingSafeEqual } from "crypto";
import httpStatus from "http-status";
import config, { OTP } from "@/config";
import { prisma } from "@/shared/prisma";
import { logger } from "@/shared/logger";
import ApiError, { badRequest } from "@/errors/ApiError";
import { toLocalPhone } from "@/helpers/phoneHelper";
import { enqueue } from "@/jobs/queue";

/**
 * One-time SMS codes, used by customer login and staff password reset.
 *
 *   sendCode(phone, purpose, text)  → saves a hashed code and sends it by SMS
 *   useCode(phone, purpose, code)   → checks it (and marks it used) or throws
 *
 * A code only works for its purpose, so a login code can't reset a password.
 * Limits: 1 code per minute and 5 per hour per number; 5 wrong tries per code.
 */
export type OtpPurpose = "login" | "password_reset";

const tooManyRequests = (message: string) => new ApiError(httpStatus.TOO_MANY_REQUESTS, message);

/** The phone in "01XXXXXXXXX" form, or a 400 error. */
export const requireLocalPhone = (raw: string): string => {
  const phone = toLocalPhone(raw);
  if (!phone)
    throw badRequest("Please enter a valid Bangladeshi mobile number (01XXXXXXXXX).", "phone_number");
  return phone;
};

/** A keyed hash of phone + purpose + code. Only this is stored, so a database leak doesn't reveal codes. */
const hashCode = (phone: string, purpose: OtpPurpose, code: string): string =>
  createHmac("sha256", config.jwt.accessSecret).update(`${phone}:${purpose}:${code}`).digest("hex");

/** Compare two hashes in constant time (doesn't leak how many characters matched). */
const sameHash = (a: string, b: string): boolean => {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
};

/**
 * The fixed test code (OTP_STATIC_CODE) for this phone, or undefined for a random code.
 * Only for login — password reset always uses a real code.
 */
const staticCodeFor = (phone: string, purpose: OtpPurpose): string | undefined => {
  const { staticCode, staticPhones } = config.otp;
  if (!staticCode || purpose !== "login") return undefined;
  if (staticPhones.length === 0) return staticCode;

  const allowed = staticPhones.map((number) => toLocalPhone(number));
  return allowed.includes(phone) ? staticCode : undefined;
};

/** Throws 429 if this number asked for a code too recently or too often. */
const checkSendLimits = async (phone: string): Promise<void> => {
  const latest = await prisma.otpCode.findFirst({ where: { phone }, orderBy: { createdAt: "desc" } });
  if (latest) {
    const secondsSince = (Date.now() - latest.createdAt.getTime()) / 1000;
    if (secondsSince < OTP.resendAfterSeconds) {
      const wait = Math.ceil(OTP.resendAfterSeconds - secondsSince);
      throw tooManyRequests(`Please wait ${wait} seconds before requesting a new code.`);
    }
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const sentThisHour = await prisma.otpCode.count({ where: { phone, createdAt: { gte: oneHourAgo } } });
  if (sentThisHour >= OTP.maxPerHour) {
    throw tooManyRequests("Too many codes requested for this number. Please try again in an hour.");
  }
};

/** Create a code, save its hash and send it by SMS. `smsText` builds the message. */
export const sendCode = async (
  phone: string,
  purpose: OtpPurpose,
  smsText: (code: string, minutes: number) => string
) => {
  await checkSendLimits(phone);

  const staticCode = staticCodeFor(phone, purpose);
  const code = staticCode ?? String(randomInt(0, 10 ** OTP.length)).padStart(OTP.length, "0");

  // Only the newest code works: retire older unused ones, then save the new one.
  await prisma.$transaction([
    prisma.otpCode.updateMany({ where: { phone, purpose, used_at: null }, data: { used_at: new Date() } }),
    prisma.otpCode.create({
      data: {
        phone,
        purpose,
        code_hash: hashCode(phone, purpose, code),
        expires_at: new Date(Date.now() + OTP.expiresInSeconds * 1000),
      },
    }),
  ]);

  // A fixed test code is not sent by SMS (the tester already knows it).
  if (!staticCode) {
    const minutes = Math.round(OTP.expiresInSeconds / 60);
    void enqueue("sms.send", { to: phone, message: smsText(code, minutes) });
  }

  // Outside production the code is also logged and returned, so you can test without SMS.
  const showCode = !config.isProd;
  if (showCode) logger.info({ phone, purpose, code }, "one-time code (dev only)");

  return {
    phone_number: phone,
    expires_in: OTP.expiresInSeconds,
    resend_in: OTP.resendAfterSeconds,
    ...(showCode ? { dev_otp: code } : {}),
  };
};

/** Check a code. Right → it's marked used. Wrong, expired or used → throws 400 / 429. */
export const useCode = async (phone: string, purpose: OtpPurpose, code: string): Promise<void> => {
  const otp = await prisma.otpCode.findFirst({
    where: { phone, purpose, used_at: null },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.expires_at < new Date()) {
    throw badRequest("This code has expired or was not found. Please request a new code.", "otp");
  }
  if (otp.attempts >= OTP.maxAttempts) {
    throw tooManyRequests("Too many wrong attempts. Please request a new code.");
  }

  if (!sameHash(otp.code_hash, hashCode(phone, purpose, String(code).trim()))) {
    const updated = await prisma.otpCode.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    const left = OTP.maxAttempts - updated.attempts;
    if (left <= 0) throw tooManyRequests("Too many wrong attempts. Please request a new code.");
    throw badRequest(`Wrong code. ${left} attempt(s) left.`, "otp");
  }

  // The code can't be used again.
  await prisma.otpCode.update({ where: { id: otp.id }, data: { used_at: new Date() } });
};
