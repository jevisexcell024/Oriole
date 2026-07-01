import type { Request, Response, NextFunction } from "express";
import type { ZodType } from "zod";

type Where = "body" | "query" | "params";

/**
 * Request-validation middleware. Parses and (where applicable) coerces the given
 * part of the request against a Zod schema, replacing it with the typed result.
 * On failure it returns 400 with a structured field-error map.
 */
export function validate(schema: ZodType, where: Where = "body") {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[where]);
    if (!result.success) {
      return res.status(400).json({ error: "Validation failed", details: result.error.flatten() });
    }
    // params is read-only on some Express versions; assign defensively.
    try { (req as unknown as Record<Where, unknown>)[where] = result.data; } catch { /* keep original */ }
    next();
  };
}
