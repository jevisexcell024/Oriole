import { describe, it, expect, beforeAll, afterAll } from "vitest";

process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

let db: typeof import("../server/db.ts")["db"];
let renderEmailTemplate: typeof import("../server/emailTemplates.ts")["renderEmailTemplate"];

beforeAll(async () => {
  const dbMod = await import("../server/db.ts");
  db = dbMod.db;
  await dbMod.initDb();
  const mod = await import("../server/emailTemplates.ts");
  renderEmailTemplate = mod.renderEmailTemplate;
}, 30000);

afterAll(async () => { await db.close(); });

describe("renderEmailTemplate (server/emailTemplates.ts)", () => {
  it("falls back to the default subject/intro with no override present", () => {
    const r = renderEmailTemplate("auth.new_signin", { name: "Ada" });
    expect(r.subject).toBe("New sign-in to your Oriole account");
    expect(r.introText).toContain("Your Oriole account was just signed in");
  });

  it("substitutes {{var}} tokens in both default subject and intro", () => {
    const r = renderEmailTemplate("results.released", { name: "Ada", examTitle: "Biology 101" });
    expect(r.subject).toBe("Your result is available — Biology 101");
    expect(r.introText).toContain("Biology 101");
  });

  it("prefers a Super Admin override once one exists", async () => {
    await db.upsert("emailTemplates", {
      id: "auth.new_signin",
      subject: "Custom subject {{name}}",
      intro: "Custom intro for {{name}}.",
      updatedAt: new Date().toISOString(),
      updatedBy: "Test Admin",
    });
    db.data!.emailTemplates.push({
      id: "auth.new_signin", subject: "Custom subject {{name}}", intro: "Custom intro for {{name}}.",
      updatedAt: new Date().toISOString(), updatedBy: "Test Admin",
    });
    const r = renderEmailTemplate("auth.new_signin", { name: "Grace" });
    expect(r.subject).toBe("Custom subject Grace");
    expect(r.introText).toBe("Custom intro for Grace.");
  });

  it("escapes HTML-significant characters in variable values for the HTML variant, but not the plain-text variant", () => {
    const r = renderEmailTemplate("results.released", { name: "Ada", examTitle: `<img src=x onerror=alert(1)> & "Chem"` });
    expect(r.introHtml).not.toContain("<img");
    expect(r.introHtml).toContain("&lt;img");
    expect(r.introText).toContain("<img src=x onerror=alert(1)>"); // plain text is never HTML-rendered, so no escaping needed
  });

  it("leaves an unrecognized {{token}} literally in place rather than silently stripping it", () => {
    const r = renderEmailTemplate("exam.reminder", { name: "Ada" }); // examTitle/label omitted
    expect(r.subject).toContain("{{examTitle}}");
    expect(r.subject).toContain("{{label}}");
  });
});
