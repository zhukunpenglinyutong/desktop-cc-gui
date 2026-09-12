import { describe, expect, it } from "vitest";
import {
  KNOWN_PERMISSIONS,
  execGrantAllows,
  isKnownPermission,
  networkGrantAllows,
} from "@ccgui/plugin-sdk";
import spec from "../../../../packages/plugin-sdk/spec/permissions.json";

describe("isKnownPermission", () => {
  it("accepts every base permission (15 项)", () => {
    for (const p of Object.keys(KNOWN_PERMISSIONS)) {
      expect(isKnownPermission(p)).toBe(true);
    }
    expect(Object.keys(KNOWN_PERMISSIONS)).toHaveLength(15);
  });

  it("accepts well-shaped network: grants (bare host / port / port range)", () => {
    expect(isKnownPermission("network:127.0.0.1")).toBe(true);
    expect(isKnownPermission("network:example.com")).toBe(true);
    expect(isKnownPermission("network:api.example.com:8443")).toBe(true);
    expect(isKnownPermission("network:127.0.0.1:7680-7690")).toBe(true);
    expect(isKnownPermission("network:localhost:1-65535")).toBe(true);
  });

  it("rejects malformed network: grants", () => {
    expect(isKnownPermission("network:")).toBe(false);
    expect(isKnownPermission("network:*")).toBe(false);
    expect(isKnownPermission("network:*.example.com")).toBe(false);
    expect(isKnownPermission("network:exam ple.com")).toBe(false);
    expect(isKnownPermission("network:example.com:abc")).toBe(false);
    expect(isKnownPermission("network:example.com:0")).toBe(false);
    expect(isKnownPermission("network:example.com:65536")).toBe(false);
    expect(isKnownPermission("network:example.com:7690-7680")).toBe(false);
    expect(isKnownPermission("network:example.com:80-")).toBe(false);
    expect(isKnownPermission("network:example.com:80:90")).toBe(false);
    expect(isKnownPermission("network://example.com")).toBe(false);
  });

  it("accepts well-shaped exec: grants; rejects paths and empties", () => {
    expect(isKnownPermission("exec:npm")).toBe(true);
    expect(isKnownPermission("exec:tokentracker-cli")).toBe(true);
    expect(isKnownPermission("exec:node.exe")).toBe(true);
    expect(isKnownPermission("exec:")).toBe(false);
    expect(isKnownPermission("exec:/usr/bin/npm")).toBe(false);
    expect(isKnownPermission("exec:bin/npm")).toBe(false);
    expect(isKnownPermission("exec:..\\npm")).toBe(false);
    expect(isKnownPermission("exec:np m")).toBe(false);
  });

  it("cmd: grants are gone; typos and unknowns reject", () => {
    expect(isKnownPermission("cmd:tt_proxy")).toBe(false);
    expect(isKnownPermission("network:grpc:443:extra")).toBe(false);
    expect(isKnownPermission("storag")).toBe(false);
    expect(isKnownPermission("")).toBe(false);
  });
});

describe("networkGrantAllows", () => {
  it("bare host grant covers any port on that exact host", () => {
    const grants = ["network:example.com"];
    expect(networkGrantAllows(grants, "https://example.com/api")).toBe(true);
    expect(networkGrantAllows(grants, "http://example.com:8443/api")).toBe(true);
  });

  it("port and port-range grants bound the url port", () => {
    const grants = ["network:127.0.0.1:7680-7690"];
    expect(networkGrantAllows(grants, "http://127.0.0.1:7680/x")).toBe(true);
    expect(networkGrantAllows(grants, "http://127.0.0.1:7684/x")).toBe(true);
    expect(networkGrantAllows(grants, "http://127.0.0.1:7690/x")).toBe(true);
    expect(networkGrantAllows(grants, "http://127.0.0.1:7691/x")).toBe(false);
    expect(networkGrantAllows(grants, "http://127.0.0.1:7679/x")).toBe(false);
    expect(networkGrantAllows(["network:127.0.0.1:7684"], "http://127.0.0.1:7684/x")).toBe(true);
    expect(networkGrantAllows(["network:127.0.0.1:7684"], "http://127.0.0.1:7685/x")).toBe(false);
  });

  it("default ports resolve by protocol (80/443)", () => {
    expect(networkGrantAllows(["network:example.com:443"], "https://example.com/")).toBe(true);
    expect(networkGrantAllows(["network:example.com:443"], "http://example.com/")).toBe(false);
    expect(networkGrantAllows(["network:example.com:80"], "http://example.com/")).toBe(true);
  });

  it("host matching is exact: subdomains, lookalikes, and other hosts miss", () => {
    const grants = ["network:example.com"];
    expect(networkGrantAllows(grants, "https://api.example.com/")).toBe(false);
    expect(networkGrantAllows(grants, "https://example.com.evil.io/")).toBe(false);
    expect(networkGrantAllows(grants, "https://other.com/")).toBe(false);
    // case-insensitive
    expect(networkGrantAllows(["network:EXAMPLE.com"], "https://example.COM/")).toBe(true);
  });

  it("only http/https urls can match; garbage and other schemes reject", () => {
    const grants = ["network:example.com"];
    expect(networkGrantAllows(grants, "ftp://example.com/")).toBe(false);
    expect(networkGrantAllows(grants, "file:///etc/passwd")).toBe(false);
    expect(networkGrantAllows(grants, "not a url")).toBe(false);
    expect(networkGrantAllows(grants, "")).toBe(false);
  });

  it("undeclared or malformed grants never allow", () => {
    expect(networkGrantAllows([], "https://example.com/")).toBe(false);
    expect(networkGrantAllows(["network:none", "storage"], "https://example.com/")).toBe(false);
    expect(networkGrantAllows(["network:example.com:abc"], "https://example.com/")).toBe(false);
    expect(networkGrantAllows(["exec:example.com"], "https://example.com/")).toBe(false);
  });
});

describe("execGrantAllows", () => {
  it("matches declared bins exactly", () => {
    const grants = ["exec:npm", "exec:tokentracker-cli"];
    expect(execGrantAllows(grants, "npm")).toBe(true);
    expect(execGrantAllows(grants, "tokentracker-cli")).toBe(true);
    expect(execGrantAllows(grants, "node")).toBe(false);
    expect(execGrantAllows(grants, "NPM")).toBe(false);
    expect(execGrantAllows(grants, "npm-cli")).toBe(false);
  });

  it("rejects bins that are not bare names even if declared-shaped", () => {
    expect(execGrantAllows(["exec:bin/sh"], "bin/sh")).toBe(false);
    expect(execGrantAllows(["exec:/bin/sh"], "/bin/sh")).toBe(false);
    expect(execGrantAllows(["exec:"], "")).toBe(false);
  });
});

// 以下用例直接由 spec/permissions.json（权限/授权的单一事实源）驱动：
// TS（本实现）、Rust（plugins.rs include_str!）、模板 validate-manifest.mjs
// 三方跑同一组向量，任何漂移都会在其中一处失败。
describe("spec/permissions.json vectors", () => {
  it("KNOWN_PERMISSIONS is generated from spec.knownPermissions", () => {
    expect(Object.keys(KNOWN_PERMISSIONS).sort()).toEqual([...spec.knownPermissions].sort());
  });

  it("drives networkGrantShapes.valid through isKnownPermission", () => {
    for (const p of spec.networkGrantShapes.valid) {
      expect(isKnownPermission(p), p).toBe(true);
    }
  });

  it("drives networkGrantShapes.invalid through isKnownPermission", () => {
    for (const p of spec.networkGrantShapes.invalid) {
      if (p === "network:none") {
        // network:none 是基座权限（经 KNOWN_PERMISSIONS 命中），永远不是授权；
        // 其"不放行"行为由 networkAllow 向量覆盖。
        expect(isKnownPermission(p), p).toBe(true);
      } else {
        expect(isKnownPermission(p), p).toBe(false);
      }
    }
  });

  it("drives networkAllow vectors through networkGrantAllows", () => {
    for (const v of spec.networkAllow) {
      expect(networkGrantAllows(v.grants, v.url), JSON.stringify(v)).toBe(v.allowed);
    }
  });

  it("drives execGrantShapes through isKnownPermission", () => {
    for (const p of spec.execGrantShapes.valid) {
      expect(isKnownPermission(p), p).toBe(true);
    }
    for (const p of spec.execGrantShapes.invalid) {
      expect(isKnownPermission(p), p).toBe(false);
    }
  });

  it("drives execAllow vectors through execGrantAllows", () => {
    for (const v of spec.execAllow) {
      expect(execGrantAllows(v.grants, v.bin), JSON.stringify(v)).toBe(v.allowed);
    }
  });
});
