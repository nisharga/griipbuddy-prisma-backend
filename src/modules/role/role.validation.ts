import { z } from "zod";
import { PERMISSIONS } from "@/constants/permissions";

export const permissionList = z.array(z.enum(PERMISSIONS as unknown as [string, ...string[]]), {
  invalid_type_error: "permissions must be a list",
});

const createRoleSchema = z.object({
  body: z.object({
    role_name: z.string({ required_error: "Role name is required" }).trim().min(1, "Role name is required"),
    permissions: permissionList.default([]),
  }),
});

const updateRoleSchema = z.object({
  body: z.object({
    role_name: z.string().trim().min(1, "Role name is required").optional(),
    permissions: permissionList.optional(),
  }),
});

export const RoleValidation = { createRoleSchema, updateRoleSchema };
