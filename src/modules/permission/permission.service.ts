import { UserService } from "@/modules/user/user.service";

/**
 * PATCH /permissions sets permissions on a staff member OR a role (the admin's role
 * table passes the role id). The logic lives with users, which owns both cases.
 */
const setPermissions = (id: string, permissions: string[]) => UserService.setPermissions(id, permissions);

export const PermissionService = { setPermissions };
