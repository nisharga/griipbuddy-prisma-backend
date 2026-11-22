import { prisma } from "@/shared/prisma";
import { badRequest, conflict, notFound } from "@/errors/ApiError";
import { SUPER_ROLES } from "@/constants/permissions";

const getRoles = async () => ({ roles: await prisma.role.findMany({ orderBy: { createdAt: "asc" } }) });

const getRoleById = async (id: string) => {
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) throw notFound("Role");
  return role;
};

const createRole = async (data: { role_name: string; permissions: string[] }, createdById: string) => {
  if (await prisma.role.count({ where: { role_name: data.role_name } }))
    throw conflict("A role with this name already exists.");
  return prisma.role.create({ data: { ...data, created_by_id: createdById } });
};

const updateRole = async (id: string, data: { role_name?: string; permissions?: string[] }) => {
  const role = await getRoleById(id);
  const renaming = data.role_name !== undefined && data.role_name !== role.role_name;
  if (renaming && SUPER_ROLES.includes(role.role_name))
    throw badRequest("Built-in super roles cannot be renamed.");
  if (renaming && (await prisma.role.count({ where: { role_name: data.role_name, NOT: { id } } }))) {
    throw conflict("A role with this name already exists.");
  }
  // Staff carry their role's name and inherit its permissions — keep them in sync atomically.
  const [updated] = await prisma.$transaction([
    prisma.role.update({ where: { id }, data }),
    prisma.user.updateMany({
      where: { role_ref_id: id },
      data: {
        ...(renaming ? { role: data.role_name } : {}),
        ...(data.permissions ? { permissions: data.permissions } : {}),
      },
    }),
  ]);
  return updated;
};

const deleteRole = async (id: string) => {
  const role = await getRoleById(id);
  if (SUPER_ROLES.includes(role.role_name)) throw badRequest("Built-in super roles cannot be deleted.");
  const assigned = await prisma.user.count({ where: { role_ref_id: id, is_deleted: false } });
  if (assigned)
    throw badRequest(`This role is assigned to ${assigned} staff member(s). Reassign them first.`);
  return prisma.role.delete({ where: { id } });
};

export const RoleService = { getRoles, getRoleById, createRole, updateRole, deleteRole };
