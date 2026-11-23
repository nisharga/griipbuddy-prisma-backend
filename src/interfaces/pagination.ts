export type IPaginationOptions = {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
};

/** Result of paginationHelpers.calculatePagination: page + optional sort from the query string. */
export type IPagination = {
  page: number;
  limit: number;
  skip: number;
  /** ?sortBy — only used when the service allows that field (see `sortBy` in queryBuilder). */
  sortBy?: string;
  /** ?sortOrder — "asc" or "desc" (default "desc"). */
  sortOrder: "asc" | "desc";
};
