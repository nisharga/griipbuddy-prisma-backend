import type { RequestHandler, Router } from "express";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod/v3";
import { API_PREFIX, APP_NAME } from "@/config";
import { auth, customer } from "@/middlewares/auth";
import type { RequestSchema } from "@/middlewares/validateRequest";
import { moduleRoutes } from "@/routes";
import { ENDPOINTS, TAGS, type EndpointDoc } from "./endpoints";

/**
 * Builds the OpenAPI (Swagger) document from the real Express routes, so the docs
 * never drift from the code. For every route it reads:
 *   path + method                     → the endpoint
 *   validateRequest(schema)           → body / query / path fields (from the Zod schema)
 *   auth · staff("perm") · customer   → 🔒 + who may call it
 *   multer (file uploads)             → multipart form
 * Summaries and notes come from ./endpoints.ts (optional per endpoint).
 */

type JsonSchema = Record<string, unknown>;
type Operation = Record<string, unknown>;
type DocHandler = RequestHandler & { schema?: RequestSchema; permission?: string | string[] };
type RouteLayer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: DocHandler }[] };
};

const toJsonSchema = (schema: ZodTypeAny): JsonSchema => {
  const result = zodToJsonSchema(schema, {
    target: "openApi3",
    $refStrategy: "none",
    removeAdditionalStrategy: "strict", // Zod drops unknown keys (doesn't reject them) unless .strict()
  }) as JsonSchema;
  delete result.$schema;
  return result;
};

/** The { body, query, params } parts of a validateRequest schema (refine() wrappers removed). */
const partsOf = (schema: RequestSchema) => {
  let object: ZodTypeAny = schema;
  while (object._def.typeName === "ZodEffects") object = object._def.schema;
  const shape = (object._def.shape?.() ?? {}) as Record<string, ZodTypeAny | undefined>;
  return { body: shape.body, query: shape.query, params: shape.params } as {
    body?: ZodTypeAny;
    query?: ZodTypeAny;
    params?: ZodTypeAny;
  };
};

/** Fields of a Zod object as OpenAPI parameters (for query / path). */
const fieldsToParameters = (schema: ZodTypeAny | undefined, location: "query" | "path") => {
  if (!schema) return [];
  let object: ZodTypeAny = schema;
  while (object._def.typeName === "ZodEffects") object = object._def.schema;
  const shape = (object._def.shape?.() ?? {}) as Record<string, ZodTypeAny>;
  return Object.entries(shape).map(([name, field]) => ({
    name,
    in: location,
    required: location === "path" || !field.isOptional(),
    schema: toJsonSchema(field),
  }));
};

/** "/orders/:id" → "/orders/{id}" and the names ["id"]. */
const toOpenApiPath = (path: string) => {
  const names: string[] = [];
  const openApiPath = path.replace(/:(\w+)/g, (_match, name: string) => {
    names.push(name);
    return `{${name}}`;
  });
  return { openApiPath, names };
};

/** Who may call it, read from the route's middlewares. */
const accessOf = (handlers: DocHandler[]) => {
  const permission = handlers.find((handler) => handler.permission)?.permission;
  if (handlers.includes(customer))
    return { secured: true, note: "🔒 Logged-in **customer** (phone + OTP login)." };
  if (permission) {
    const keys = [permission].flat().map((key) => `\`${key}\``);
    return { secured: true, note: `🔒 **Staff** with permission ${keys.join(" or ")}.` };
  }
  if (handlers.includes(auth)) return { secured: true, note: "🔒 Any logged-in **staff** member." };
  return { secured: false, note: "🌐 Public." };
};

const multipartBody = (field: "file" | "files") => ({
  required: true,
  content: {
    "multipart/form-data": {
      schema: {
        type: "object",
        required: [field],
        properties:
          field === "file"
            ? { file: { type: "string", format: "binary" } }
            : { files: { type: "array", items: { type: "string", format: "binary" } } },
      },
    },
  },
});

/** One OpenAPI operation for a route. */
const buildOperation = (method: string, fullPath: string, tag: string, handlers: DocHandler[]) => {
  const key = `${method.toUpperCase()} ${fullPath}`;
  const extra: EndpointDoc = ENDPOINTS[key] ?? {};
  const schema = handlers.find((handler) => handler.schema)?.schema;
  const parts: ReturnType<typeof partsOf> = schema ? partsOf(schema) : {};
  const { openApiPath, names } = toOpenApiPath(fullPath);
  const access = accessOf(handlers);

  // Path params: every ":name" in the URL (typed from the schema when it has them).
  const typedPathParams = fieldsToParameters(parts.params, "path");
  const pathParams = names.map(
    (name) =>
      typedPathParams.find((param) => param.name === name) ?? {
        name,
        in: "path",
        required: true,
        schema: { type: "string" },
      }
  );
  const queryParams = [...fieldsToParameters(parts.query, "query"), ...(extra.list ? LIST_QUERY : [])];

  const operation: Operation = {
    tags: [tag],
    summary: extra.summary,
    description: [access.note, extra.description].filter(Boolean).join("\n\n"),
    parameters: [...pathParams, ...queryParams],
    responses: {
      "2XX": { $ref: "#/components/responses/Success" },
      ...(schema || extra.upload ? { "400": { $ref: "#/components/responses/BadRequest" } } : {}),
      ...(access.secured
        ? {
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
          }
        : {}),
      ...(names.length ? { "404": { $ref: "#/components/responses/NotFound" } } : {}),
    },
  };
  if (access.secured) operation.security = [{ bearerAuth: [] }];

  const isUpload = handlers.some((handler) => handler.name === "multerMiddleware");
  if (isUpload) {
    operation.requestBody = multipartBody(extra.upload ?? "file");
  } else if (parts.body) {
    operation.requestBody = {
      required: !parts.body.isOptional(),
      content: { "application/json": { schema: toJsonSchema(parts.body) } },
    };
  }

  return { openApiPath, operation };
};

/** ?page=&limit=&search=&sortBy=&sortOrder= — shared by list endpoints. */
const LIST_QUERY = [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, default: 10 } },
  { name: "search", in: "query", schema: { type: "string" } },
  { name: "sortBy", in: "query", schema: { type: "string" } },
  { name: "sortOrder", in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
];

const envelope = (success: boolean, extra: JsonSchema = {}): JsonSchema => ({
  type: "object",
  properties: {
    statusCode: { type: "integer", example: success ? 200 : 400 },
    success: { type: "boolean", example: success },
    message: { type: "string" },
    ...extra,
  },
});

const COMPONENTS = {
  securitySchemes: {
    bearerAuth: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      description:
        "The `access_token` from a login (staff: POST /user/admin/login, customer: POST /customer/otp/verify).",
    },
  },
  responses: {
    Success: {
      description: "Success (200, or 201 when something was created)",
      content: {
        "application/json": {
          schema: envelope(true, {
            data: { description: "The result (object, list or null)." },
            meta: {
              type: "object",
              description: "Only on paginated lists.",
              properties: {
                page: { type: "integer" },
                limit: { type: "integer" },
                total: { type: "integer" },
                totalPage: { type: "integer" },
              },
            },
          }),
        },
      },
    },
    ...Object.fromEntries(
      [
        ["BadRequest", "Invalid input (see errorMessages)"],
        ["Unauthorized", "Not logged in, or the token expired / was logged out"],
        ["Forbidden", "Logged in, but not allowed"],
        ["NotFound", "Not found"],
      ].map(([name, description]) => [
        name,
        {
          description,
          content: {
            "application/json": {
              schema: envelope(false, {
                errorMessages: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { path: { type: "string" }, message: { type: "string" } },
                  },
                },
              }),
            },
          },
        },
      ])
    ),
  },
};

/** The whole OpenAPI 3 document. */
export const buildOpenApi = () => {
  const paths: Record<string, Record<string, Operation>> = {
    "/health": {
      get: {
        tags: ["system"],
        summary: "Health check (database + Redis)",
        description: "🌐 Public. 200 when the database answers, 503 otherwise.",
        responses: { "2XX": { $ref: "#/components/responses/Success" } },
      },
    },
  };

  for (const { path: basePath, route } of moduleRoutes) {
    const tag = basePath.replace(/^\//, "");
    for (const layer of (route as Router & { stack: RouteLayer[] }).stack) {
      if (!layer.route) continue;
      const fullPath = `${basePath}${layer.route.path === "/" ? "" : layer.route.path}`;
      const handlers = layer.route.stack.map((item) => item.handle);

      for (const method of Object.keys(layer.route.methods)) {
        const { openApiPath, operation } = buildOperation(method, fullPath, tag, handlers);
        paths[openApiPath] ??= {};
        paths[openApiPath][method] = operation;
      }
    }
  }

  return {
    openapi: "3.0.3",
    info: {
      title: `${APP_NAME} API`,
      version: "1.0.0",
      description: [
        "Generated from the Express routes and their Zod schemas (`npm run docs`).",
        "",
        "**Log in**, copy `access_token`, click **Authorize** and paste it.",
        "Every response is `{ statusCode, success, message, data, meta? }`; errors add `errorMessages[]`.",
        "File fields hold short paths like `uploads/<id>.jpg` — the frontend adds the file base URL.",
      ].join("\n"),
    },
    servers: [{ url: API_PREFIX, description: "This server" }],
    tags: [{ name: "system", description: "Server status" }, ...TAGS],
    paths,
    components: COMPONENTS,
  };
};

/** Keys in ./endpoints.ts that match no route (typos, or a route that was removed). */
export const unknownEndpointKeys = (doc: ReturnType<typeof buildOpenApi>): string[] => {
  const existing = new Set<string>();
  for (const [openApiPath, methods] of Object.entries(doc.paths)) {
    const expressPath = openApiPath.replace(/\{(\w+)\}/g, ":$1");
    for (const method of Object.keys(methods)) existing.add(`${method.toUpperCase()} ${expressPath}`);
  }
  return Object.keys(ENDPOINTS).filter((key) => !existing.has(key));
};
