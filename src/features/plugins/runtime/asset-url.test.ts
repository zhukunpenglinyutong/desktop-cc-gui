import { beforeEach, describe, expect, it, vi } from "vitest";

const environment = vi.hoisted(() => ({ web: true, windows: false, token: "lan-token" as string | null }));
vi.mock("@/lib/transport", () => ({
  get isWeb() { return environment.web; },
  get webToken() { return environment.token; },
}));
vi.mock("@/lib/platform", () => ({
  get IS_WINDOWS() { return environment.windows; },
}));

import { directoryAssetUrl, fileAssetUrl, remoteAssetUrl } from "./asset-url";

beforeEach(() => {
  environment.web = true;
  environment.windows = false;
  environment.token = "lan-token";
});

describe("plugin resource URL resolution", () => {
  it("keeps LAN authorization and remote origin when loading relative dependencies", () => {
    const model = remoteAssetUrl("sample.plugin", new URL("https://assets.example:8443/models/one/model.json?revision=2"));
    const child = new URL("textures/texture 1.png", model);
    expect(child.href).toBe(`${window.location.origin}/plugin-asset/lan-token/sample.plugin/remote/${btoa("https://assets.example:8443").replace(/=+$/, "")}/models/one/textures/texture%201.png`);
    expect(new URL(model).search).toBe("?revision=2");
    environment.token = null;
    const relayed = directoryAssetUrl("sample.plugin", "directory-id", "one/model.json");
    expect(new URL("../shared/image.png", relayed).pathname).toBe("/plugin-asset/-/sample.plugin/dir/directory-id/shared/image.png");
  });

  it("treats local filenames as paths, not query strings or already-encoded URLs", () => {
    const resource = new URL(fileAssetUrl("sample.plugin", "doc", "目录/a%2Fb #?.json"));
    expect(resource.search).toBe("");
    expect(resource.hash).toBe("");
    expect(decodeURIComponent(resource.pathname.split("/").at(-1)!)).toBe("a%2Fb #?.json");
    for (const path of ["/private/file", "../file", "nested/../../file", "C:/private/file", "nested\\file", "nested//file", "bad\u0000file"]) {
      expect(() => fileAssetUrl("sample.plugin", "bundle", path)).toThrow(/path/i);
    }
    expect(() => directoryAssetUrl("sample.plugin", "../other-plugin", "file.json")).toThrow(/grant/i);
  });

  it("resolves native siblings using the platform protocol without web credentials", () => {
    environment.web = false;
    environment.windows = true;
    const windows = fileAssetUrl("sample.plugin", "bundle", "assets/model.json");
    expect(new URL("texture.png", windows).href).toBe("http://pluginasset.localhost/sample.plugin/bundle/assets/texture.png");
    environment.windows = false;
    const other = fileAssetUrl("sample.plugin", "bundle", "assets/model.json");
    expect(new URL("texture.png", other).href).toBe("pluginasset://localhost/sample.plugin/bundle/assets/texture.png");
  });
});
