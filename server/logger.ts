import pino from "pino";
import pinoHttp from "pino-http";
import { env } from "./env.ts";

export const logger = pino({
  level: env.logLevel ?? (env.isProd ? "info" : "debug"),
  // Never log session cookies or auth headers.
  redact: { paths: ["req.headers.cookie", "req.headers.authorization", "res.headers['set-cookie']"], remove: true },
  ...(env.isProd ? {} : { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } }),
});

export const httpLogger = pinoHttp({
  logger,
  // Health/readiness checks are noise — log them at trace only.
  customLogLevel(req, res, err) {
    if (req.url === "/api/health" || req.url === "/api/ready") return "silent";
    if (res.statusCode >= 500 || err) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
});
