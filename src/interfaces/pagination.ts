export type IPaginationOptions = {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
};

/** Result of paginationHelpers.calculatePagination. */
export type IPagination = { page: number; limit: number; skip: number };
