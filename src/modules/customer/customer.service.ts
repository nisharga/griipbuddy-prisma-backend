import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import httpStatus from "http-status";
import type { Prisma } from "@prisma/client";
import config, { APP_NAME, OTP } from "@/config";
import { prisma } from "@/shared/prisma";
import { logger } from "@/shared/logger";
import ApiError, { badRequest, forbidden, notFound, unauthorized } from "@/errors/ApiError";
import { CUSTOMER_ROLE } from "@/constants/permissions";
import { issueTokens, verifyRefreshToken } from "@/helpers/jwtHelpers";
import { hashPassword } from "@/helpers/passwordHelper";
import { phoneVariants, toLocalPhone } from "@/helpers/phoneHelper";
import { paginate, sortBy } from "@/helpers/queryBuilder";
import type { IPagination } from "@/interfaces/pagination";
import { enqueue } from "@/jobs/queue";

/**
 * Storefront customers: phone number + OTP login (no password), their profile,
 * and their orders (every order placed with their phone number).
 *
 *   1. sendOtp    → a 6-digit code is sent by SMS
 *   2. verifyOtp  → logged in (the account is created on first login)
 */

/** The customer fields the storefront sees (never the password). */
const CUSTOMER_FIELDS = {
  id: true,
  full_name: true,
  phone_number: true,
  email: true,
  gender: true,
  address: true,
  profile_url: true,
  createdAt: true,
} as const;

// ---------------------------------------------------------------- helpers

/** The phone in "01XXXXXXXXX" form, or a 400 error. */
const requireLocalPhone = (raw: string): string => {
  const phone = toLocalPhone(raw);
  if (!phone)
    throw badRequest("Please enter a valid Bangladeshi mobile number (01XXXXXXXXX).", "phone_number");
  return phone;
};

/** A keyed hash of phone + code. Only this is stored, so a database leak doesn't reveal codes. */
const hashCode = (phone: string, code: string): string =>
  createHmac("sha256", config.jwt.accessSecret).update(`${phone}:${code}`).digest("hex");

/** Compare two hashes in constant time (doesn't leak how many characters matched). */
const sameHash = (a: string, b: string): boolean => {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
};

const tooManyRequests = (message: string) => new ApiError(httpStatus.TOO_MANY_REQUESTS, message);

/** "PAID" / "PARTIAL" / "VERIFYING" (payment sent, waiting for admin) / "UNPAID". */
const paymentStatusOf = (order: {
  total_amount: Prisma.Decimal;
  paid_amount: Prisma.Decimal;
  manual_payment_info: Prisma.JsonValue;
}): string => {
  const paid = order.paid_amount.toNumber();
  if (paid >= order.total_amount.toNumber()) return "PAID";
  if (paid > 0) return "PARTIAL";
  if (order.manual_payment_info) return "VERIFYING";
  return "UNPAID";
};

// ---------------------------------------------------------------- OTP login

/** Send a login code to a phone number. */
const sendOtp = async (rawPhone: string) => {
  const phone = requireLocalPhone(rawPhone);

  // Limit how often one number can ask for codes.
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

  const code = String(randomInt(0, 10 ** OTP.length)).padStart(OTP.length, "0");

  // Only the newest code works: retire older unused ones, then save the new one.
  await prisma.$transaction([
    prisma.otpCode.updateMany({ where: { phone, used_at: null }, data: { used_at: new Date() } }),
    prisma.otpCode.create({
      data: {
        phone,
        code_hash: hashCode(phone, code),
        expires_at: new Date(Date.now() + OTP.expiresInSeconds * 1000),
      },
    }),
  ]);

  const minutes = Math.round(OTP.expiresInSeconds / 60);
  const message = `${code} is your ${APP_NAME} login code. It expires in ${minutes} minutes. Don't share it with anyone.`;
  void enqueue("sms.send", { to: phone, message });

  // Outside production the code is also logged and returned, so you can test without SMS.
  const showCode = !config.isProd;
  if (showCode) logger.info({ phone, code }, "login code (dev only)");

  return {
    phone_number: phone,
    expires_in: OTP.expiresInSeconds,
    resend_in: OTP.resendAfterSeconds,
    ...(showCode ? { dev_otp: code } : {}),
  };
};

/** Check the code and log the customer in. First login creates their account. */
const verifyOtp = async (rawPhone: string, code: string) => {
  const phone = requireLocalPhone(rawPhone);

  const otp = await prisma.otpCode.findFirst({
    where: { phone, used_at: null },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.expires_at < new Date()) {
    throw badRequest("This code has expired or was not found. Please request a new code.", "otp");
  }
  if (otp.attempts >= OTP.maxAttempts) {
    throw tooManyRequests("Too many wrong attempts. Please request a new code.");
  }

  if (!sameHash(otp.code_hash, hashCode(phone, String(code).trim()))) {
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

  let user = await prisma.user.findFirst({ where: { phone_number: phone, is_deleted: false } });
  if (user && user.role !== CUSTOMER_ROLE) {
    throw forbidden("This number belongs to a staff account. Please use the admin login.");
  }

  if (!user) {
    // First login: create the account, named after their latest order if there is one.
    const lastOrder = await prisma.order.findFirst({
      where: { customer_phone: { in: phoneVariants(phone) } },
      orderBy: { order_date: "desc" },
      select: { customer_name: true },
    });
    user = await prisma.user.create({
      data: {
        full_name: lastOrder?.customer_name ?? "Customer",
        phone_number: phone,
        // Customers log in with OTP only; this random password is never used.
        password: await hashPassword(randomBytes(32).toString("hex")),
        role: CUSTOMER_ROLE,
        userType: "CUSTOMER",
        permissions: [],
        is_verified_number: true,
      },
    });
  }

  if (user.status !== "ACTIVE") throw forbidden("Your account is not active. Please contact us.");

  // Link orders placed with this number (e.g. as a guest) to the account.
  await prisma.order.updateMany({
    where: { customer_phone: { in: phoneVariants(phone) }, user_id: null },
    data: { user_id: user.id },
  });
  await prisma.user.update({ where: { id: user.id }, data: { last_active: new Date() } });

  const tokens = issueTokens({ id: user.id, role: user.role, phone_number: user.phone_number });
  const profile = await getMe(user.id);
  return { ...tokens, user: profile };
};

/** New tokens from a refresh token (active customers only). */
const refresh = async (refreshToken: string) => {
  const { id } = verifyRefreshToken(refreshToken);

  const user = await prisma.user.findFirst({ where: { id, is_deleted: false, status: "ACTIVE" } });
  if (!user || user.role !== CUSTOMER_ROLE) throw unauthorized("Please log in again.");

  const tokens = issueTokens({ id: user.id, role: user.role, phone_number: user.phone_number });
  return tokens;
};

// ---------------------------------------------------------------- profile

/** The logged-in customer's profile. */
const getMe = async (id: string) => {
  const result = await prisma.user.findFirst({ where: { id, is_deleted: false }, select: CUSTOMER_FIELDS });
  if (!result) throw notFound("Customer");
  return result;
};

/** Update name, email, gender or address (the phone number can't be changed here). */
const updateMe = async (
  id: string,
  body: { full_name?: string; email?: string; gender?: string; address?: Prisma.InputJsonValue }
) => {
  const data: Prisma.UserUpdateInput = {};
  if (body.full_name !== undefined) data.full_name = body.full_name;
  if (body.email !== undefined) data.email = body.email || null;
  if (body.gender !== undefined) data.gender = body.gender || null;
  if (body.address !== undefined) data.address = body.address;

  await prisma.user.update({ where: { id }, data });
  return getMe(id);
};

// ---------------------------------------------------------------- orders

/** What a customer sees of their order (no admin notes, logs or internal fields). */
const ORDER_SELECT = {
  id: true,
  order_serial_id: true,
  invoice_number: true,
  status: true,
  order_date: true,
  order_note: true,
  delivery_address: true,
  payment_type: true,
  manual_payment_info: true,
  sub_total: true,
  delivery_charge: true,
  total_discount: true,
  total_amount: true,
  payable_amount: true,
  paid_amount: true,
  COD: true,
  products: {
    select: {
      id: true,
      product_name: true,
      variant_sku: true,
      total_quantity: true,
      unit_price: true,
      total_price: true,
      selected_variant: true,
      product: { select: { id: true, name: true, slug: true, thumbnail: true } },
    },
  },
  status_history: { select: { status: true, changed_at: true }, orderBy: { changed_at: "asc" as const } },
} satisfies Prisma.OrderSelect;

/** Orders that belong to this customer: linked to their account, or placed with their phone. */
const ownOrdersWhere = async (customerId: string): Promise<Prisma.OrderWhereInput> => {
  const me = await getMe(customerId);
  return {
    is_deleted: false,
    OR: [{ user_id: customerId }, { customer_phone: { in: phoneVariants(me.phone_number) } }],
  };
};

/** The customer's orders, newest first, each with a simple `payment_status`. */
const getMyOrders = async (customerId: string, pagination: IPagination) => {
  const where = await ownOrdersWhere(customerId);
  const orderBy = sortBy(pagination, ["order_date", "total_amount"], { order_date: "desc" } as const);

  const result = await paginate(pagination, {
    findMany: (page) => prisma.order.findMany({ where, select: ORDER_SELECT, orderBy, ...page }),
    count: () => prisma.order.count({ where }),
  });

  const data = result.data.map((order) => ({ ...order, payment_status: paymentStatusOf(order) }));
  return { data, meta: result.meta };
};

/** One of the customer's orders (404 if it isn't theirs). */
const getMyOrder = async (customerId: string, orderId: string) => {
  const where = await ownOrdersWhere(customerId);
  const order = await prisma.order.findFirst({ where: { ...where, id: orderId }, select: ORDER_SELECT });
  if (!order) throw notFound("Order");
  return { ...order, payment_status: paymentStatusOf(order) };
};

export const CustomerService = { sendOtp, verifyOtp, refresh, getMe, updateMe, getMyOrders, getMyOrder };
