import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { passwordSetupToken, verifyPasswordSetupToken } from "../server/auth.ts";
import { env } from "../server/env.ts";

// Regression coverage for the account-setup link (replaces emailing a plain-
// text temporary password — see setupLinkEmail() in server/index.ts). The
// token itself only proves "this is a legitimate setup link for this user";
// single-use enforcement lives in the endpoint (checks user.mustChangePassword)
// since a bare JWT can't track consumption on its own — these tests pin the
// token layer only.
describe("password setup token (server/auth.ts)", () => {
  it("round-trips: a token signed for a user verifies back to that same user id", () => {
    const token = passwordSetupToken("user_123");
    expect(verifyPasswordSetupToken(token)).toBe("user_123");
  });

  it("rejects a garbage/tampered token", () => {
    expect(verifyPasswordSetupToken("not-a-real-token")).toBeNull();
    const token = passwordSetupToken("user_123");
    expect(verifyPasswordSetupToken(token.slice(0, -2) + "xx")).toBeNull();
  });

  it("rejects an empty token", () => {
    expect(verifyPasswordSetupToken("")).toBeNull();
  });

  it("does not double as a 2FA-pending or session token — the purpose claim is checked", () => {
    // A token signed for a different purpose (same secret, same signing
    // mechanism) must not be accepted here even though it's a structurally
    // valid, correctly-signed JWT — pwSetup must actually be true.
    const otherPurposeToken = jwt.sign({ sub: "user_123", p2fa: true }, env.jwtSecret, { expiresIn: "5m" });
    expect(verifyPasswordSetupToken(otherPurposeToken)).toBeNull();
  });
});
