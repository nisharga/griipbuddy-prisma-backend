import { z } from "zod/v3";
import { permissionList } from "@/modules/role/role.validation";

const setPermissionsSchema = z.object({
  body: z.object({
    id: z.string({ required_error: "id is required" }).trim().min(1, "id is required"),
    permissions: permissionList,
  }),
});

export const PermissionValidation = { setPermissionsSchema };
