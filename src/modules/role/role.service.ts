import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import { badRequest, conflict, notFound } from "@/errors/ApiError";
import { SUPER_ROLES } from "@/constants/permissions";

/**
 * Staff roles. Each staff member keeps a copy of their role's name and
 * permissions, so changing a role also updates everyone who has it.
 */

// ---------------------------------------------------------------- read

/** All roles, oldest first. */
const getRoles = async () => {
  const roles = await prisma.role.findMany({ orderBy: { createdAt: "asc" } });
  return { roles };
};

/** One role by id. */
const getRoleById = async (id: string): Promise<Role> => {
  const result = await prisma.role.findUnique({ where: { id } });
  if (!result) throw notFound("Role");
  return result;
};

// ---------------------------------------------------------------- write

const createRole = async (
  data: { role_name: string; permissions: string[] },
  createdById: string
): Promise<Role> => {
  const nameTaken = await prisma.role.count({ where: { role_name: data.role_name } });
  if (nameTaken) throw conflict("A role with this name already exists.");

  const result = await prisma.role.create({ data: { ...data, created_by_id: createdById } });
  return result;
};

const updateRole = async (
  id: string,
  data: { role_name?: string; permissions?: string[] }
): Promise<Role> => {
  const role = await getRoleById(id);
  const isRenaming = data.role_name !== undefined && data.role_name !== role.role_name;

  if (isRenaming && SUPER_ROLES.includes(role.role_name)) {
    throw badRequest("Built-in super roles cannot be renamed.");
  }
  if (isRenaming) {
    const nameTaken = await prisma.role.count({ where: { role_name: data.role_name, NOT: { id } } });
    if (nameTaken) throw conflict("A role with this name already exists.");
  }

  // What changes on the staff who have this role.
  const staffChanges: Prisma.UserUpdateManyMutationInput = {};
  if (isRenaming) staffChanges.role = data.role_name;
  if (data.permissions) staffChanges.permissions = data.permissions;

  // Role and its staff are updated together (all or nothing).
  const [result] = await prisma.$transaction([
    prisma.role.update({ where: { id }, data }),
    prisma.user.updateMany({ where: { role_ref_id: id }, data: staffChanges }),
  ]);
  return result;
};

/** Built-in super roles, and roles still assigned to staff, can't be deleted. */
const deleteRole = async (id: string): Promise<Role> => {
  const role = await getRoleById(id);
  if (SUPER_ROLES.includes(role.role_name)) throw badRequest("Built-in super roles cannot be deleted.");

  const assignedCount = await prisma.user.count({ where: { role_ref_id: id, is_deleted: false } });
  if (assignedCount) {
    throw badRequest(`This role is assigned to ${assignedCount} staff member(s). Reassign them first.`);
  }

  const result = await prisma.role.delete({ where: { id } });
  return result;
};

export const RoleService = { getRoles, getRoleById, createRole, updateRole, deleteRole };
