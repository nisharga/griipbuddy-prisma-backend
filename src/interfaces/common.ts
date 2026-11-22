import type { IGenericErrorMessage } from "./error";

export type IMeta = {
  page: number;
  limit: number;
  total: number;
  totalPage: number;
};

export type IGenericResponse<T> = {
  meta: IMeta;
  data: T;
};

export type IGenericErrorResponse = {
  statusCode: number;
  message: string;
  errorMessages: IGenericErrorMessage[];
};

/** The logged-in staff member, attached to `req.user` by the auth middleware. */
export type IAuthUser = {
  id: string;
  role: string;
  permissions: string[];
  is_super: boolean;
};
