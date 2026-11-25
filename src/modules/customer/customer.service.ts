import { randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import { APP_NAME } from "@/config";
import { prisma } from "@/shared/prisma";
import { forbidden, notFound, unauthorized } from "@/errors/ApiError";
import { CUSTOMER_ROLE } from "@/constants/permissions";
import { assertTokenCurrent, issueTokens, verifyRefreshToken } from "@/helpers/jwtHelpers";
import { requireLocalPhone, sendCode, useCode } from "@/helpers/otpHelper";
import { hashPassword } from "@/helpers/passwordHelper";
import { phoneVariants } from "@/helpers/phoneHelper";
import { paginate, sortBy } from "@/helpers/queryBuilder";
import type { IPagination } from "@/interfaces/pagination";

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

  const result = await sendCode(
    phone,
    "login",
    (code, minutes) =>
      `${code} is your ${APP_NAME} login code. It expires in ${minutes} minutes. Don't share it with anyone.`
  );
  return result;
};

/** Check the code and log the customer in. First login creates their account. */
const verifyOtp = async (rawPhone: string, code: string) => {
  const phone = requireLocalPhone(rawPhone);
  await useCode(phone, "login", code);

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

  const tokens = issueTokens(user);
  const profile = await getMe(user.id);
  return { ...tokens, user: profile };
};

/** New tokens from a refresh token (active customers only). */
const refresh = async (refreshToken: string) => {
  const payload = verifyRefreshToken(refreshToken);

  const user = await prisma.user.findFirst({
    where: { id: payload.id, is_deleted: false, status: "ACTIVE" },
  });
  if (!user || user.role !== CUSTOMER_ROLE) throw unauthorized("Please log in again.");
  assertTokenCurrent(payload, user);

  const tokens = issueTokens(user);
  return tokens;
};

/** Log out on every device: all tokens issued so far stop working. */
const logout = async (id: string): Promise<void> => {
  await prisma.user.update({ where: { id }, data: { token_version: { increment: 1 } } });
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

export const CustomerService = {
  sendOtp,
  verifyOtp,
  refresh,
  logout,
  getMe,
  updateMe,
  getMyOrders,
  getMyOrder,
};
