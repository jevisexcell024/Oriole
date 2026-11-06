// Creates (once) a local demo ADMIN for trying the console. The generated password is written to
// scripts/demo-admin.local.txt (gitignored), never logged. Local development only.
//   npx tsx --env-file=.env scripts/seed-demo-admin.ts
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, initDb } from "../server/db.ts";
import { BCRYPT_COST } from "../server/env.ts";

const EMAIL = "demo.admin@orcalis.dev";
await initDb();
if (db.data.users.some((u) => u.email === EMAIL)) { console.log("Demo admin already exists (see scripts/demo-admin.local.txt)."); process.exit(0); }
const tenantId = db.data.users.find((u) => u.role === "admin")?.tenantId ?? db.data.tenants[0]?.id;
const password = randomBytes(9).toString("base64url") + "-Aa9";
const user = {
  id: "demo_admin", tenantId, email: EMAIL, name: "Demo Admin", role: "admin" as const,
  passwordHash: bcrypt.hashSync(password, BCRYPT_COST), mustChangePassword: false,
};
db.data.users.push(user as never);
await db.upsert("users", user as never);
fs.writeFileSync(new URL("./demo-admin.local.txt", import.meta.url), `${EMAIL}\n${password}\n`);
console.log("Created demo admin; credentials saved to scripts/demo-admin.local.txt");
process.exit(0);
