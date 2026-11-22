import { PERMISSIONS, SUPER_ROLES } from "@/constants/permissions";
import type { IAuthUser } from "@/interfaces/common";

export const isSuperRole = (role?: string): boolean => !!role && SUPER_ROLES.includes(role);

/** Effective permissions for a user: everything for super roles. */
export const effectivePermissions = (role: string, permissions: string[] = []): string[] =>
  isSuperRole(role) ? [...PERMISSIONS] : permissions;

/** True if the user holds ANY of the given permission key(s). */
export const can = (user: IAuthUser, key: string | string[]): boolean => {
  if (user.is_super) return true;
  const keys = Array.isArray(key) ? key : [key];
  return keys.some((k) => user.permissions.includes(k));
};
