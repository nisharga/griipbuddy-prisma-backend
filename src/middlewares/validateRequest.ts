import type { RequestHandler } from "express";
import type { AnyZodObject, ZodEffects } from "zod/v3";

export type RequestSchema = AnyZodObject | ZodEffects<AnyZodObject>;

/**
 * Validate { body, query, params } against a Zod schema before the controller runs.
 * The schema is also kept on the middleware (`.schema`) so the API docs can show it.
 */
const validateRequest = (schema: RequestSchema) => {
  const middleware: RequestHandler = async (req, _res, next) => {
    try {
      await schema.parseAsync({ body: req.body ?? {}, query: req.query, params: req.params });
      next();
    } catch (err) {
      next(err);
    }
  };
  return Object.assign(middleware, { schema });
};

export default validateRequest;
