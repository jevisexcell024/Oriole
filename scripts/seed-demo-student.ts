// Creates (once) a throwaway demo student for local UI checks. The generated
// password is written to scripts/demo-student.local.txt (gitignored), never logged.
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, initDb } from "../server/db.ts";
import { BCRYPT_COST } from "../server/env.ts";

const EMAIL = "demo.student@orcalis.dev";
await initDb();
const existing = db.data.users.find((u) => u.email === EMAIL);
if (existing) { console.log("Demo student already exists."); process.exit(0); }
const tenantId = db.data.users.find((u) => u.role === "candidate")?.tenantId;
const password = randomBytes(9).toString("base64url");
const user = {
  id: "demo_student", tenantId, email: EMAIL, name: "Demo Student", role: "candidate" as const,
  passwordHash: bcrypt.hashSync(password, BCRYPT_COST), mustChangePassword: false,
};
db.data.users.push(user as never);
await db.upsert("users", user as never);
fs.writeFileSync(new URL("./demo-student.local.txt", import.meta.url), `${EMAIL}\n${password}\n`);
console.log("Created demo student; credentials saved to scripts/demo-student.local.txt");
process.exit(0);