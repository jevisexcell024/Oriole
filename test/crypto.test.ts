import { describe, it, expect, beforeAll } from "vitest";

// A deterministic 32-byte key, set before importing the module under test
// (env is read at module load).
const KEY = Buffer.alloc(32, 7).toString("base64");

let encryptString: (s: string) => string;
let decryptString: (s: string | null | undefined) => string | null | undefined;
let encryptionEnabled: () => boolean;

beforeAll(async () => {
  process.env.DATA_ENCRYPTION_KEY = KEY;
  const mod = await import("../server/crypto.ts");
  encryptString = mod.encryptString;
  decryptString = mod.decryptString;
  encryptionEnabled = mod.encryptionEnabled;
});

describe("field encryption (AES-256-GCM)", () => {
  it("reports enabled when a key is configured", () => {
    expect(encryptionEnabled()).toBe(true);
  });

  it("round-trips a value", () => {
    const plain = "data:image/png;base64,AAAABBBBCCCC";
    const enc = encryptString(plain);
    expect(enc.startsWith("enc:v1:")).toBe(true);
    expect(enc).not.toContain(plain);
    expect(decryptString(enc)).toBe(plain);
  });

  it("produces a unique ciphertext per call (random IV)", () => {
    expect(encryptString("same")).not.toBe(encryptString("same"));
  });

  it("passes plaintext / legacy values through untouched", () => {
    expect(decryptString("data:image/png;legacy")).toBe("data:image/png;legacy");
    expect(decryptString(null)).toBe(null);
  });

  it("rejects tampered ciphertext (auth tag)", () => {
    const enc = encryptString("secret");
    const tampered = enc.slice(0, -4) + (enc.endsWith("A") ? "B" : "A") + enc.slice(-3);
    expect(() => decryptString(tampered)).toThrow();
  });
});
