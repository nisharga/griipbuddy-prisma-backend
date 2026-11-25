import type { Request, RequestHandler } from "express";
import { prisma } from "@/shared/prisma";
import { forbidden, unauthorized } from "@/errors/ApiError";
import { assertTokenCurrent, verifyAccessToken } from "@/helpers/jwtHelpers";
import { CUSTOMER_ROLE } from "@/constants/permissions";
import { can, effectivePermissions, isSuperRole } from "@/helpers/permissionHelper";
import type { IAuthUser } from "@/interfaces/common";

const bearer = (req: Request) => {
  const t = req.headers.authorization?.replace(/^Bearer\s+/i, "").trim();
  return t && t !== "undefined" && t !== "null" ? t : undefined;
};

/** Staff-only: verifies the access token and loads a fresh user (status/permissions may have changed). */
export const auth: RequestHandler = async (req, _res, next) => {
  try {
    const token = bearer(req);
    if (!token) throw unauthorized();
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: {
        id: true,
        role: true,
        permissions: true,
        status: true,
        is_deleted: true,
        token_version: true,
      },
    });
    if (!user || user.is_deleted) throw unauthorized("Your account no longer exists. Please log in again.");
    assertTokenCurrent(payload, user);
    if (user.status !== "ACTIVE")
      throw forbidden("Your account is not active. Please contact an administrator.");
    if (user.role === CUSTOMER_ROLE) throw forbidden("Customers cannot access the admin panel.");

    const authUser: IAuthUser = {
      id: user.id,
      role: user.role,
      permissions: effectivePermissions(user.role, user.permissions),
      is_super: isSuperRole(user.role),
    };
    req.user = authUser;
    next();
  } catch (err) {
    next(err);
  }
};

/** Requires ANY of the given permissions. Use after `auth`. */
export const requirePermission =
  (key: string | string[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!can(req.user, key)) return next(forbidden());
    next();
  };

/** `auth` + `requirePermission` in one. */
export const staff = (key?: string | string[]): RequestHandler[] =>
  key ? [auth, requirePermission(key)] : [auth];

/**
 * Storefront customers only (phone + OTP login). Sets `req.user` with no
 * permissions; staff tokens are refused here, like customer tokens are in `auth`.
 */
export const customer: RequestHandler = async (req, _res, next) => {
  try {
    const token = bearer(req);
    if (!token) throw unauthorized();

    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, role: true, status: true, is_deleted: true, token_version: true },
    });
    if (!user || user.is_deleted) throw unauthorized("Your account no longer exists. Please log in again.");
    assertTokenCurrent(payload, user);
    if (user.role !== CUSTOMER_ROLE) throw forbidden("Please log in with your customer account.");
    if (user.status !== "ACTIVE") throw forbidden("Your account is not active. Please contact us.");

    req.user = { id: user.id, role: user.role, permissions: [], is_super: false };
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * For endpoints shared by admin and storefront: true when a valid staff token is
 * present (e.g. to include unpublished items). Never throws.
 */
export const isStaffRequest = (req: Request): boolean => {
  const token = bearer(req);
  if (!token) return false;
  try {
    const { role } = verifyAccessToken(token);
    return !!role && role !== CUSTOMER_ROLE;
  } catch {
    return false;
  }
};
