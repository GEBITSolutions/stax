import { describe, expect, it } from "vitest";
import { resolveFrameworkRef } from "../src/version.ts";

describe("resolveFrameworkRef", () => {
  it.each(["1.2.3", "2.0.0", "2.4.1-rc.2"])("uses the exact published package version %s", (version) => {
    expect(resolveFrameworkRef(version)).toBe(version);
  });

  it.each(["main", "feature/foo", "v2.4.1", "true", "12345", "0123456789abcdef0123456789abcdef01234567"])(
    "accepts a safe development tag, branch, or commit %s",
    (ref) => {
      expect(resolveFrameworkRef("0.0.0-development", ref)).toBe(ref);
    },
  );

  it("requires an explicit ref for the development package", () => {
    expect(() => resolveFrameworkRef("0.0.0-development")).toThrow();
    expect(() => resolveFrameworkRef("0.0.0-development", "")).toThrow();
  });

  it.each([" main", "main ", "feature/my branch", "feature/x\njobs: injected", "foo # injected", "${{ github.ref }}", "../main", "feature//x", "feature/../x", "feature/@{upstream}", "-bad", "refs/heads/x.lock"])(
    "rejects an unsafe development ref %j",
    (ref) => {
      expect(() => resolveFrameworkRef("0.0.0-development", ref)).toThrow();
    },
  );

  it("rejects a ref override for a published version, even when it matches", () => {
    expect(() => resolveFrameworkRef("1.2.3", "main")).toThrow();
    expect(() => resolveFrameworkRef("1.2.3", "1.2.3")).toThrow();
  });
});
