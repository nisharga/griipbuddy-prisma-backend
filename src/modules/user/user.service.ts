import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "@/errors/ApiError";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { contains } from "@/helpers/queryHelper";
import type { IPagination } from "@/interfaces/pagination";
import { issueTokens, verifyRefreshToken } from "@/helpers/jwtHelpers";
import { hashPassword, verifyPassword } from "@/helpers/passwordHelper";
import { CUSTOMER_ROLE } from "@/constants/permissions";
import { effectivePermissions } from "@/helpers/permissionHelper";

const OUTLET = { select: { id: true, name: true, slug: true, type: true } } as const;

/** A user as the admin expects it: outlet included, effective permissions, no password. */
const getProfile = async (id: string) => {
  const user = await prisma.user.findFirst({ where: { id, is_deleted: false }, include: { outlet: OUTLET } });
  if (!user) throw notFound("User");
  return { ...user, permissions: effectivePermissions(user.role, user.permissions) };
};

const adminLogin = async (phone_number: string, password: string) => {
  const user = await prisma.user.findFirst({ where: { phone_number, is_deleted: false } });
  // Same message for unknown phone and wrong password (don't reveal which accounts exist).
  if (!user || !(await verifyPassword(password, user.password)))
    throw unauthorized("Invalid phone number or password.");
  if (user.role === CUSTOMER_ROLE) throw forbidden("You are not authorized to access this application!");
  if (user.status !== "ACTIVE")
    throw forbidden("Your account is not active. Please contact an administrator.");

  await prisma.user.update({ where: { id: user.id }, data: { last_active: new Date() } });
  const tokens = issueTokens({ id: user.id, role: user.role, phone_number: user.phone_number });
  return { ...tokens, user: await getProfile(user.id) };
};

const refresh = async (refreshToken: string) => {
  const { id } = verifyRefreshToken(refreshToken);
  const user = await prisma.user.findFirst({ where: { id, is_deleted: false, status: "ACTIVE" } });
  if (!user || user.role === CUSTOMER_ROLE) throw unauthorized("Please log in again.");
  return issueTokens({ id: user.id, role: user.role, phone_number: user.phone_number });
};

const roleData = async (roleId: string) => {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw badRequest("Selected role does not exist.", "role_ref");
  return { role: role.role_name, role_ref_id: role.id, permissions: role.permissions };
};

const assertPhoneFree = async (phone_number: string, exceptId?: string) => {
  const taken = await prisma.user.count({
    where: { phone_number, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (taken) throw conflict("A user with this phone number already exists.");
};

type StaffInput = {
  full_name?: string;
  email?: string;
  phone_number?: string;
  password?: string;
  role_ref?: string;
  outlet?: string;
  gender?: string;
};

const createStaff = async (input: StaffInput) => {
  await assertPhoneFree(input.phone_number!);
  const user = await prisma.user.create({
    data: {
      full_name: input.full_name!,
      phone_number: input.phone_number!,
      email: input.email || null,
      gender: input.gender,
      outlet_id: input.outlet || null,
      password: await hashPassword(input.password!),
      userType: "STAFF",
      ...(await roleData(input.role_ref!)),
    },
  });
  return getProfile(user.id);
};

const updateStaff = async (id: string, input: StaffInput) => {
  const user = await prisma.user.findFirst({ where: { id, is_deleted: false } });
  if (!user) throw notFound("Staff");
  if (input.phone_number && input.phone_number !== user.phone_number)
    await assertPhoneFree(input.phone_number, id);

  const data: Prisma.UserUncheckedUpdateInput = {
    full_name: input.full_name,
    phone_number: input.phone_number,
    gender: input.gender,
    ...(input.email !== undefined ? { email: input.email || null } : {}),
    ...(input.outlet !== undefined ? { outlet_id: input.outlet || null } : {}),
    ...(input.password ? { password: await hashPassword(input.password) } : {}),
    ...(input.role_ref ? await roleData(input.role_ref) : {}),
  };
  await prisma.user.update({ where: { id }, data });
  return getProfile(id);
};

/** Soft delete. The phone number is freed so it can be used for a new account. */
const deleteUser = async (id: string, actorId: string) => {
  if (id === actorId) throw badRequest("You cannot delete your own account.");
  const user = await prisma.user.findFirst({ where: { id, is_deleted: false } });
  if (!user) throw notFound("User");
  await prisma.user.update({
    where: { id },
    data: { is_deleted: true, status: "DELETED", phone_number: `${user.phone_number}#deleted-${Date.now()}` },
  });
};

/** Users filtered by role names (staff list, customer list). */
const listByRoles = async (p: IPagination, roles: string[], search?: string) => {
  const where: Prisma.UserWhereInput = {
    is_deleted: false,
    ...(roles.length ? { role: { in: roles } } : {}),
    ...(search
      ? {
          OR: [
            { full_name: contains(search) },
            { phone_number: contains(search) },
            { email: contains(search) },
          ],
        }
      : {}),
  };
  const [data, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      include: { outlet: OUTLET },
      orderBy: { createdAt: "desc" },
      skip: p.skip,
      take: p.limit,
    }),
    prisma.user.count({ where }),
  ]);
  return { meta: paginationHelpers.buildMeta(p, total), data };
};

const changePassword = async (id: string, newPassword: string) => {
  const user = await prisma.user.findFirst({ where: { id, is_deleted: false } });
  if (!user) throw notFound("User");
  await prisma.user.update({ where: { id }, data: { password: await hashPassword(newPassword) } });
};

/**
 * PATCH /permissions — the admin uses it for a staff member AND for a role (the
 * role table passes the role id). Updating a role refreshes everyone assigned to it.
 */
const setPermissions = async (id: string, permissions: string[]) => {
  const user = await prisma.user.findFirst({ where: { id, is_deleted: false } });
  if (user) {
    await prisma.user.update({ where: { id }, data: { permissions } });
    return getProfile(id);
  }
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) throw notFound("User or role");
  const [updated] = await prisma.$transaction([
    prisma.role.update({ where: { id }, data: { permissions } }),
    prisma.user.updateMany({ where: { role_ref_id: id }, data: { permissions } }),
  ]);
  return updated;
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
