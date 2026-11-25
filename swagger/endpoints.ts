/**
 * Optional extra text for the API docs. Everything else (paths, methods, body /
 * query / path fields, who may call it) is read from the code by ./build.ts.
 *
 * Key: "METHOD /path" exactly as the route is written (":id" style), without /api/v1.
 * A new endpoint shows up in the docs without an entry here — add one only to explain it.
 */
export type EndpointDoc = {
  summary?: string;
  description?: string;
  /** Adds ?page &limit &search &sortBy &sortOrder. */
  list?: boolean;
  /** File field name for upload routes (default "file"). */
  upload?: "file" | "files";
};

/** One group per module, in this order. */
export const TAGS: { name: string; description: string }[] = [
  { name: "user", description: "Staff: login, logout, passwords, staff accounts" },
  { name: "customer", description: "Storefront customers: phone + OTP login, profile, own orders" },
  { name: "roles", description: "Staff roles" },
  { name: "permissions", description: "Permissions of a staff member or role" },
  { name: "upload", description: "File uploads → short paths (`uploads/<id>.jpg`)" },
  { name: "video", description: "Old video upload path (same as /upload/video/single)" },
  { name: "business-location", description: "Warehouses / outlets and stock reports" },
  { name: "category", description: "Categories" },
  { name: "sub-category", description: "Sub-categories and sub-sub-categories" },
  { name: "brand", description: "Brands" },
  { name: "return-policy", description: "Return policies" },
  { name: "product", description: "Products and variants (storefront + admin)" },
  { name: "stocks", description: "Stock per variant × location, adjustments" },
  { name: "purchase", description: "Buying stock from suppliers" },
  { name: "order", description: "Orders: checkout, tracking, admin management" },
  { name: "supplier", description: "Suppliers" },
  { name: "cms", description: "Storefront content: homepage, hero videos" },
  { name: "review", description: "Product reviews" },
  { name: "faq", description: "Product questions & answers" },
];

export const ENDPOINTS: Record<string, EndpointDoc> = {
  // ------------------------------------------------------------ staff
  "POST /user/admin/login": {
    summary: "Staff login (phone + password)",
    description:
      "Returns `access_token`, `refresh_token` and the user. Use the access token with **Authorize**.",
  },
  "POST /user/refresh-token": { summary: "New tokens from a refresh token" },
  "POST /user/logout": { summary: "Log out on every device" },
  "PATCH /user/change-password": {
    summary: "Change my password",
    description: "Needs the current password. Returns new tokens; other devices are logged out.",
  },
  "POST /user/forgot-password": {
    summary: "Forgot password: send a reset code by SMS",
    description: "Unknown numbers get the same reply. Outside production the code is returned as `dev_otp`.",
  },
  "POST /user/reset-password": {
    summary: "Forgot password: code + new password",
    description: "Logs out every device.",
  },
  "GET /user": { summary: "My profile (with permissions)" },
  "POST /user/recruit/staff": { summary: "Create a staff member" },
  "GET /user/admin/all/roles": {
    summary: "List users by role",
    description: "`?role=ADMIN,MANAGER` (comma-separated).",
    list: true,
  },
  "PUT /user/update/staff/:id": {
    summary: "Update a staff member",
    description: "Sending `password` also logs them out everywhere.",
  },
  "PATCH /user/admin/change-password/:id": {
    summary: "Set someone's password (admin)",
    description: "They are logged out everywhere.",
  },
  "GET /user/:id": { summary: "One user" },
  "DELETE /user/:id": { summary: "Delete a user (soft delete; the phone number is freed)" },

  // ------------------------------------------------------------ customer
  "POST /customer/otp/send": {
    summary: "Send a login code by SMS",
    description:
      "1 code per minute, 5 per hour per number; expires in 5 minutes. Outside production (or with `OTP_STATIC_CODE`) see `dev_otp`.",
  },
  "POST /customer/otp/verify": {
    summary: "Log in with the code",
    description:
      "Creates the account on first login and links earlier orders with this phone. 5 wrong tries cancel the code.",
  },
  "POST /customer/refresh-token": { summary: "New tokens from a refresh token" },
  "POST /customer/logout": { summary: "Log out on every device" },
  "GET /customer/me": { summary: "My profile" },
  "PATCH /customer/me": { summary: "Update my profile" },
  "GET /customer/orders": {
    summary: "My orders",
    description: "Each order has `payment_status`: PAID, PARTIAL, VERIFYING or UNPAID.",
    list: true,
  },
  "GET /customer/orders/:id": { summary: "One of my orders" },

  // ------------------------------------------------------------ uploads
  "POST /upload/payment-proof": { summary: "Upload a bKash / Nagad screenshot (checkout)" },
  "POST /upload/single": { summary: "Upload one image or video", upload: "file" },
  "POST /upload/multiple": { summary: "Upload up to 20 images / videos", upload: "files" },
  "POST /upload/video/single": { summary: "Upload one video", upload: "file" },
  "POST /upload/video/multiple": { summary: "Upload up to 10 videos", upload: "files" },
  "POST /video/upload": { summary: "Upload one video (old path)", upload: "file" },

  // ------------------------------------------------------------ catalog
  "GET /business-location": { summary: "List locations", list: true },
  "GET /business-location/stock/all": { summary: "Stock report", list: true },
  "GET /business-location/stock/category/subcategory": { summary: "Stock report by category", list: true },
  "GET /category": { summary: "List categories", list: true },
  "GET /category/published/all": { summary: "Published categories (storefront)" },
  "GET /category/:idOrSlug": { summary: "One category by id or slug" },
  "GET /sub-category": { summary: "List sub-categories", list: true },
  "GET /brand/admin/all": { summary: "List brands", list: true },
  "GET /return-policy": { summary: "List return policies", list: true },

  // ------------------------------------------------------------ products
  "GET /product": { summary: "Storefront product list (filters, price range)", list: true },
  "GET /product/ids": { summary: "Products by ids", list: true },
  "GET /product/public/random": { summary: "Random products", list: true },
  "GET /product/slug/:slug": { summary: "Product page (by slug)" },
  "GET /product/admin/all": { summary: "Admin product list", list: true },
  "GET /product/admin/variants": { summary: "Search variants", list: true },
  "GET /product/variants/all": { summary: "Search variants", list: true },
  "POST /product": { summary: "Create a product with its variants" },

  // ------------------------------------------------------------ stock & purchases
  "GET /stocks": { summary: "Stock rows", list: true },
  "GET /stocks/adjustment": { summary: "Stock adjustments", list: true },
  "POST /stocks/adjustment": { summary: "Add or remove stock" },
  "GET /stocks/:productId/:variantId": { summary: "Available quantity of a variant (storefront)" },
  "GET /purchase": { summary: "List purchases", list: true },
  "POST /purchase": { summary: "Create a purchase (status `received` adds the stock)" },
  "GET /supplier": { summary: "List suppliers", list: true },

  // ------------------------------------------------------------ orders
  "POST /order": {
    summary: "Place an order (checkout)",
    description: "Prices and totals are recalculated on the server; stock is reserved.",
  },
  "GET /order": { summary: "Admin order list", list: true },
  "GET /order/track-by-sl/:ref": { summary: "Track an order by number" },
  "GET /order/customer/my-order": {
    summary: "My orders (same as GET /customer/orders)",
    list: true,
  },
  "GET /order/status/count": { summary: "Order counts per status" },
  "PATCH /order/:id/status": {
    summary: "Change order status",
    description: "Moves stock (reserve / ship / release) and may SMS the customer.",
  },

  // ------------------------------------------------------------ cms
  "GET /cms/homepage": { summary: "Homepage sections" },
  "GET /cms/hero-section": { summary: "Hero videos, in order" },
  "POST /cms/hero-section": { summary: "Add a hero video (max 3)" },
  "PUT /cms/hero-section": {
    summary: "Save all hero videos",
    description: "Items with `_id` are updated, new ones added, missing ones removed.",
  },
  "PATCH /cms/hero-section/:id": { summary: "Edit a hero video" },
  "DELETE /cms/hero-section/:id": { summary: "Delete a hero video" },

  // ------------------------------------------------------------ reviews & faq
  "GET /review/public/product/:slug": { summary: "Approved reviews of a product" },
  "GET /review/public/rating/:slug": { summary: "Rating summary of a product" },
  "POST /review": { summary: "Write a review" },
  "GET /review": { summary: "Admin review list", list: true },
  "GET /faq/public/product/:slug": { summary: "Answered questions of a product" },
  "POST /faq/public": { summary: "Ask a question" },
  "GET /faq/admin/all": { summary: "Admin question list", list: true },
};
