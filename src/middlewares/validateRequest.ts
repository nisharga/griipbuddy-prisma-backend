import type { RequestHandler } from "express";
import type { AnyZodObject, ZodEffects } from "zod/v3";

/** Validate { body, query, params } against a Zod schema before the controller runs. */
const validateRequest =
  (schema: AnyZodObject | ZodEffects<AnyZodObject>): RequestHandler =>
  async (req, _res, next) => {
    try {
      await schema.parseAsync({ body: req.body ?? {}, query: req.query, params: req.params });
      next();
    } catch (err) {
      next(err);
    }
  };

export default validateRequest;
