import { describe, it, expect } from "vitest";
import { looksLikeMarkupOrScript } from "../server/uploads.ts";

function dataUrl(mime: string, content: string) {
  return `data:${mime};base64,${Buffer.from(content).toString("base64")}`;
}

describe("looksLikeMarkupOrScript", () => {
  it("flags HTML disguised with a spoofed MIME type", () => {
    expect(looksLikeMarkupOrScript(dataUrl("application/pdf", "<!doctype html><html></html>"))).toBe(true);
    expect(looksLikeMarkupOrScript(dataUrl("image/png", "<html><body>hi</body></html>"))).toBe(true);
  });

  it("flags an inline <script> or <svg> payload", () => {
    expect(looksLikeMarkupOrScript(dataUrl("application/pdf", "<script>alert(1)</script>"))).toBe(true);
    expect(looksLikeMarkupOrScript(dataUrl("image/png", "<svg onload=alert(1)></svg>"))).toBe(true);
  });

  it("flags an XML prolog", () => {
    expect(looksLikeMarkupOrScript(dataUrl("application/pdf", '<?xml version="1.0"?><root/>'))).toBe(true);
  });

  it("allows a genuine PDF header", () => {
    expect(looksLikeMarkupOrScript(dataUrl("application/pdf", "%PDF-1.4\n1 0 obj<<>>endobj"))).toBe(false);
  });

  it("allows binary content that doesn't decode as readable text", () => {
    const binary = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02]).toString("base64");
    expect(looksLikeMarkupOrScript(binary)).toBe(false);
  });

  it("is case-insensitive and tolerates leading whitespace", () => {
    expect(looksLikeMarkupOrScript(dataUrl("application/pdf", "  <HTML><BODY></BODY></HTML>"))).toBe(true);
  });
});
