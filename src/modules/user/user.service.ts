import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "@/errors/ApiError";
import { notId } from "@/helpers/queryHelper";
import { NEWEST_FIRST, paginate, searchWhere, sortBy } from "@/helpers/queryBuilder";
import type { IPagination } from "@/interfaces/pagination";
import { issueTokens, verifyRefreshToken } from "@/helpers/jwtHelpers";
import { hashPassword, verifyPassword } from "@/helpers/passwordHelper";
import { CUSTOMER_ROLE } from "@/constants/permissions";
import { effectivePermissions } from "@/helpers/permissionHelper";

/** Staff accounts: admin login, tokens, staff CRUD and permissions. */

/** The outlet fields shown with a user. */
const OUTLET = { select: { id: true, name: true, slug: true, type: true } } as const;

type StaffInput = {
  full_name?: string;
  email?: string;
  phone_number?: string;
  password?: string;
  role_ref?: string;
  outlet?: string;
  gender?: string;
};

// ---------------------------------------------------------------- helpers

/** The role fields a staff member copies from their role. */
const getRoleFields = async (roleId: string) => {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw badRequest("Selected role does not exist.", "role_ref");
  return { role: role.role_name, role_ref_id: role.id, permissions: role.permissions };
};

/** Throws 409 if another user already has this phone number. */
const assertPhoneFree = async (phoneNumber: string, exceptId?: string): Promise<void> => {
  const taken = await prisma.user.count({ where: { phone_number: phoneNumber, ...notId(exceptId) } });
  if (taken) throw conflict("A user with this phone number already exists.");
};

// ---------------------------------------------------------------- login & profile

/** A user as the admin expects it: outlet included, effective permissions, no password. */
const getProfile = async (id: string) => {
  const user = await prisma.user.findFirst({ where: { id, is_deleted: false }, include: { outlet: OUTLET } });
  if (!user) throw notFound("User");

  const permissions = effectivePermissions(user.role, user.permissions);
  return { ...user, permissions };
};

/** Staff login with phone + password → tokens + profile. */
const adminLogin = async (phone_number: string, password: string) => {
  const user = await prisma.user.findFirst({ where: { phone_number, is_deleted: false } });

  // Same message for unknown phone and wrong password (don't reveal which accounts exist).
  const passwordOk = user ? await verifyPassword(password, user.password) : false;
  if (!user || !passwordOk) throw unauthorized("Invalid phone number or password.");

  if (user.role === CUSTOMER_ROLE) throw forbidden("You are not authorized to access this application!");
  if (user.status !== "ACTIVE")
    throw forbidden("Your account is not active. Please contact an administrator.");

  await prisma.user.update({ where: { id: user.id }, data: { last_active: new Date() } });

  const tokens = issueTokens({ id: user.id, role: user.role, phone_number: user.phone_number });
  const profile = await getProfile(user.id);
  return { ...tokens, user: profile };
};

/** New tokens from a refresh token (only for active staff). */
const refresh = async (refreshToken: string) => {
  const { id } = verifyRefreshToken(refreshToken);

  const user = await prisma.user.findFirst({ where: { id, is_deleted: false, status: "ACTIVE" } });
  if (!user || user.role === CUSTOMER_ROLE) throw unauthorized("Please log in again.");

  const tokens = issueTokens({ id: user.id, role: user.role, phone_number: user.phone_number });
  return tokens;
};

// ---------------------------------------------------------------- staff

/** Users with the given roles (staff/customer lists), newest first. Search: name, phone, email. Sort: full_name, createdAt, last_active. */
const listByRoles = async (pagination: IPagination, roles: string[], search?: string) => {
  const where = searchWhere<Prisma.UserWhereInput>(search, ["full_name", "phone_number", "email"]);
  where.is_deleted = false;
  if (roles.length) where.role = { in: roles };
  const orderBy = sortBy(pagination, ["full_name", "createdAt", "last_active"], NEWEST_FIRST);

  const result = await paginate(pagination, {
    findMany: (page) => prisma.user.findMany({ where, include: { outlet: OUTLET }, orderBy, ...page }),
    count: () => prisma.user.count({ where }),
  });
  return { meta: result.meta, data: result.data };
};

/** A new staff member with a role (they get the role's name and permissions). */
const createStaff = async (input: StaffInput) => {
  await assertPhoneFree(input.phone_number!);

  const roleFields = await getRoleFields(input.role_ref!);
  const user = await prisma.user.create({
    data: {
      full_name: input.full_name!,
      phone_number: input.phone_number!,
      email: input.email || null,
      gender: input.gender,
      outlet_id: input.outlet || null,
      password: await hashPassword(input.password!),
      userType: "STAFF",
      ...roleFields,
    },
  });
  return getProfile(user.id);
};

/** Update a staff member. Only the fields that were sent change. */
const updateStaff = async (id: string, input: StaffInput) => {
  const user = await prisma.user.findFirst({ where: { id, is_deleted: false } });
  if (!user) throw notFound("Staff");

  if (input.phone_number && input.phone_number !== user.phone_number) {
    await assertPhoneFree(input.phone_number, id);
  }

  const data: Prisma.UserUncheckedUpdateInput = {
    full_name: input.full_name,
    phone_number: input.phone_number,
    gender: input.gender,
  };
  // Sent as "" → cleared.
  if (input.email !== undefined) data.email = input.email || null;
  if (input.outlet !== undefined) data.outlet_id = input.outlet || null;
  if (input.password) data.password = await hashPassword(input.password);
  if (input.role_ref) Object.assign(data, await getRoleFields(input.role_ref));

  await prisma.user.update({ where: { id }, data });
  return getProfile(id);
};

/** Soft delete. The phone number is freed so it can be used for a new account. */
const deleteUser = async (id: string, actorId: string): Promise<void> => {
  if (id === actorId) throw badRequest("You cannot delete your own account.");

  const user = await prisma.user.findFirst({ where: { id, is_deleted: false } });
  if (!user) throw notFound("User");

  await prisma.user.update({
    where: { id },
    data: { is_deleted: true, status: "DELETED", phone_number: `${user.phone_number}#deleted-${Date.now()}` },
  });
};

/** Set a user's password (admin action). */
const changePassword = async (id: string, newPassword: string): Promise<void> => {
  const user = await prisma.user.findFirst({ where: { id, is_deleted: false } });
  if (!user) throw notFound("User");

  await prisma.user.update({ where: { id }, data: { password: await hashPassword(newPassword) } });
};

/**
 * PATCH /permissions — the admin uses it for a staff member AND for a role (the
 * role table passes the role id). Updating a role refreshes everyone assigned to it.
 */
const setPermissions = async (id: string, permissions: string[]) => {
  // A staff member?
  const user = await prisma.user.findFirst({ where: { id, is_deleted: false } });
  if (user) {
    await prisma.user.update({ where: { id }, data: { permissions } });
    return getProfile(id);
  }

  // Otherwise a role: update it and everyone who has it, together.
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) throw notFound("User or role");

  const [updatedRole] = await prisma.$transaction([
    prisma.role.update({ where: { id }, data: { permissions } }),
    prisma.user.updateMany({ where: { role_ref_id: id }, data: { permissions } }),
  ]);
  return updatedRole;
};

export const UserService = {
  getProfile,
  adminLogin,
  refresh,
  createStaff,
  updateStaff,
  deleteUser,
  listByRoles,
  changePassword,
  setPermissions,
};
