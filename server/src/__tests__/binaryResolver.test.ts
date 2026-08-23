import { describe, it, expect, vi } from "vitest";
import { resolveClaudeBinary, type ResolverDeps } from "../claude/binaryResolver.js";

const GNU = "@anthropic-ai/claude-agent-sdk-linux-x64/claude";
const MUSL = "@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude";

function deps(over: Partial<ResolverDeps> = {}): ResolverDeps {
  return {
    resolvePath: (pkg) => `/nm/${pkg}`,
    exists: () => true,
    glibc: () => true,
    platform: "linux",
    arch: "x64",
    warn: () => {},
    ...over,
  };
}

describe("resolveClaudeBinary", () => {
  it("on glibc Linux picks the gnu binary even when the musl package is installed", () => {
    // The production incident: both platform packages present, SDK's own
    // default tries musl first, musl can't exec on glibc.
    expect(resolveClaudeBinary(deps())).toBe(`/nm/${GNU}`);
  });

  it("never selects the musl binary on a glibc host (it cannot execute there)", () => {
    // gnu package missing entirely — undefined (let the SDK error), not musl.
    const d = deps({
      resolvePath: (pkg) => {
        if (pkg.includes("-musl")) return `/nm/${pkg}`;
        throw new Error("not installed");
      },
    });
    expect(resolveClaudeBinary(d)).toBeUndefined();
  });

  it("on a musl host prefers the musl binary", () => {
    expect(resolveClaudeBinary(deps({ glibc: () => false }))).toBe(`/nm/${MUSL}`);
  });

  it("does not wedge on a transient failure — a later call re-resolves", () => {
    // The bug that broke prod: the old resolver cached a startup-time probe
    // failure for the process lifetime. Resolution must retry.
    let installed = false;
    const d = deps({
      resolvePath: (pkg) => {
        if (!installed) throw new Error("not yet");
        return `/nm/${pkg}`;
      },
    });
    expect(resolveClaudeBinary(d)).toBeUndefined();
    installed = true;
    expect(resolveClaudeBinary(d)).toBe(`/nm/${GNU}`);
  });

  it("skips a resolved path whose file does not exist", () => {
    const d = deps({ exists: (p) => !p.includes("-musl") && p.includes("linux-x64") });
    expect(resolveClaudeBinary(d)).toBe(`/nm/${GNU}`);
    expect(resolveClaudeBinary(deps({ exists: () => false }))).toBeUndefined();
  });

  it("warns when nothing resolves so the failure is diagnosable", () => {
    const warn = vi.fn();
    resolveClaudeBinary(deps({ exists: () => false, warn }));
    expect(warn).toHaveBeenCalled();
  });

  it("uses the darwin candidate on macOS", () => {
    const d = deps({ platform: "darwin", arch: "arm64" });
    expect(resolveClaudeBinary(d)).toBe("/nm/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude");
  });
});
