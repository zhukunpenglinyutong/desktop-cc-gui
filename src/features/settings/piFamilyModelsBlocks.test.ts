import { describe, expect, it } from "vitest";
import {
  extractProviderBlock,
  removeProviderBlock,
  replaceProviderBlock,
  setProviderField,
} from "./piFamilyModelsBlocks";

const yamlConfig = `providers:
  first:
    baseUrl: https://first.example
    models:
      - id: first-model

  target:
    baseUrl: https://target.example
    headers:
      X-Test: "{}"
    models:
      - id: target-model
        name: "target // model"
  last:
    baseUrl: https://last.example
# top-level comment
`;

const jsoncConfig = `{
  // provider catalog
  "providers": {
    "first": {
      "baseUrl": "https://first.example",
      "models": [{ "id": "first-{model}" }]
    },
    /* target comment */
    "target": {
      "baseUrl": "https://target.example",
      "headers": { "X-Test": "// not a comment" },
      "models": [{ "id": "target-model", "shape": "{}" }]
    },
    "last": { "baseUrl": "https://last.example" }
  }
}
`;

describe("extractProviderBlock", () => {
  it("extracts one YAML provider without swallowing siblings or comments", () => {
    const block = extractProviderBlock(yamlConfig, "yaml", "target");

    expect(block).not.toBeNull();
    expect(block?.text).toBe(`  target:
    baseUrl: https://target.example
    headers:
      X-Test: "{}"
    models:
      - id: target-model
        name: "target // model"`);
    expect(yamlConfig.slice(0, block!.start)).toContain("first-model");
    expect(yamlConfig.slice(block!.end)).toContain("  last:");
    expect(yamlConfig.slice(block!.end)).toContain("# top-level comment");
  });

  it("extracts the final YAML provider through EOF", () => {
    const config = "providers:\r\n    first:\r\n      baseUrl: https://first.example\r\n    last:\r\n      baseUrl: https://last.example";
    const block = extractProviderBlock(config, "yaml", "last");

    expect(block?.text).toBe("    last:\r\n      baseUrl: https://last.example");
  });

  it("returns null for a provider that is not present", () => {
    expect(extractProviderBlock(yamlConfig, "yaml", "missing")).toBeNull();
    expect(extractProviderBlock(jsoncConfig, "json", "missing")).toBeNull();
  });

  it("extracts a JSONC provider while respecting comments and nested strings", () => {
    const block = extractProviderBlock(jsoncConfig, "json", "target");

    expect(block).not.toBeNull();
    expect(block?.text).toContain('"target": {');
    expect(block?.text).toContain('"// not a comment"');
    expect(block?.text).toContain('"shape": "{}"');
    expect(jsoncConfig.slice(0, block!.start)).toContain('"first"');
    expect(jsoncConfig.slice(block!.end)).toContain('"last"');
  });
});

describe("replaceProviderBlock", () => {
  it("round-trips an unchanged YAML block byte-for-byte", () => {
    const block = extractProviderBlock(yamlConfig, "yaml", "target");
    expect(block).not.toBeNull();

    expect(replaceProviderBlock(yamlConfig, block!, block!.text)).toBe(yamlConfig);
  });

  it("changes only the selected JSONC provider block", () => {
    const block = extractProviderBlock(jsoncConfig, "json", "target");
    expect(block).not.toBeNull();
    const edited = block!.text.replace(
      "https://target.example",
      "https://edited.example",
    );
    const next = replaceProviderBlock(jsoncConfig, block!, edited);

    expect(next).toContain("https://edited.example");
    expect(next).not.toContain("https://target.example");
    expect(next).toContain("https://first.example");
    expect(next).toContain("https://last.example");
    expect(next).toContain("/* target comment */");
  });
});
describe("setProviderField", () => {
  it("renames a YAML provider key and touches nothing else", () => {
    const next = setProviderField(yamlConfig, "yaml", "target", "id", "中转站");

    expect(next).not.toBeNull();
    expect(next).toContain("  中转站:\n    baseUrl: https://target.example");
    expect(next).not.toContain("  target:");
    expect(next).toContain('X-Test: "{}"');
    expect(next).toContain('name: "target // model"');
    expect(next).toContain("# top-level comment");
    expect(next).toContain("first.example");
    expect(next).toContain("  last:");
  });

  it("quotes a renamed YAML key that would re-parse differently", () => {
    const cases: Array<[string, string]> = [
      ["42", '  "42":'],
      ["no", '  "no":'],
      ["a: b", '  "a: b":'],
      ["plain-name", "  plain-name:"],
      ["胖猫pangmao", "  胖猫pangmao:"],
    ];
    for (const [value, expected] of cases) {
      const next = setProviderField(yamlConfig, "yaml", "target", "id", value);
      expect(next).toContain(`${expected}\n    baseUrl: https://target.example`);
    }
  });

  it("rewrites an existing YAML baseUrl and touches nothing else", () => {
    const next = setProviderField(yamlConfig, "yaml", "target", "baseUrl", "https://next.example/v1");

    expect(next).not.toBeNull();
    expect(next).toContain("baseUrl: https://next.example/v1");
    expect(next).not.toContain("https://target.example");
    expect(next).toContain('X-Test: "{}"');
    expect(next).toContain('name: "target // model"');
    expect(next).toContain("# top-level comment");
    expect(next).toContain("first.example");
  });

  it("adds a missing YAML field right after the provider key", () => {
    const withoutUrl = `providers:
  bare:
    models:
      - id: bare-model
  other:
    baseUrl: https://other.example
`;
    const next = setProviderField(withoutUrl, "yaml", "bare", "baseUrl", "https://added.example");

    expect(next).toContain("  bare:\n    baseUrl: https://added.example\n    models:");
    expect(next).toContain("  other:\n    baseUrl: https://other.example");
  });

  it("removes the YAML baseUrl when the value is blank", () => {
    const next = setProviderField(yamlConfig, "yaml", "target", "baseUrl", "");

    expect(next).not.toContain("https://target.example");
    expect(next).toContain("  target:\n    headers:");
    expect(next).toContain("models:");
  });

  it("renames a JSONC provider key without disturbing comments", () => {
    const next = setProviderField(jsoncConfig, "json", "target", "id", "renamed");

    expect(next).not.toBeNull();
    expect(next).toContain('"renamed": {');
    expect(next).not.toContain('"target": {');
    expect(next).toContain("/* target comment */");
    expect(next).toContain('"X-Test": "// not a comment"');
    const jsonWithoutComments = next!
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(() => JSON.parse(jsonWithoutComments)).not.toThrow();
  });

  it("rewrites an existing JSONC baseUrl without disturbing comments", () => {
    const next = setProviderField(jsoncConfig, "json", "target", "baseUrl", "https://next.example");

    expect(next).not.toBeNull();
    expect(next).toContain('"baseUrl": "https://next.example"');
    expect(next).not.toContain("https://target.example");
    expect(next).toContain("/* target comment */");
    expect(next).toContain('"X-Test": "// not a comment"');
  });

  it("adds and removes a JSONC field across the first, middle and last provider", () => {
    for (const providerId of ["first", "target", "last"] as const) {
      const added = setProviderField(jsoncConfig, "json", providerId, "baseUrl", "https://added.example")!;
      expect(added).toContain('"baseUrl": "https://added.example"');

      const removed = setProviderField(added, "json", providerId, "baseUrl", "")!;
      expect(removed).not.toContain('"baseUrl": "https://added.example"');
      expect(removed).not.toContain('"baseUrl": "https://' + providerId + '.example"');
      const jsonWithoutComments = removed
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      expect(() => JSON.parse(jsonWithoutComments)).not.toThrow();
      for (const other of ["first", "target", "last"]) {
        if (other === providerId) continue;
        expect(removed).toContain(`"baseUrl": "https://${other}.example"`);
      }
    }
  });

  it("returns null for a provider that is not present", () => {
    expect(setProviderField(yamlConfig, "yaml", "missing", "id", "x")).toBeNull();
    expect(setProviderField(jsoncConfig, "json", "missing", "baseUrl", "x")).toBeNull();
  });
});
describe("removeProviderBlock", () => {
  it("removes one YAML provider while preserving the other providers", () => {
    const block = extractProviderBlock(yamlConfig, "yaml", "target");
    expect(block).not.toBeNull();

    const next = removeProviderBlock(yamlConfig, block!, "yaml");
    expect(next).not.toContain("target.example");
    expect(next).toContain("first.example");
    expect(next).toContain("last.example");
    expect(next).toContain("# top-level comment");
  });

  it("removes the first, middle, and last JSONC properties without breaking commas", () => {
    const urls = {
      first: "https://first.example",
      target: "https://target.example",
      last: "https://last.example",
    } as const;
    for (const providerId of Object.keys(urls) as Array<keyof typeof urls>) {
      const block = extractProviderBlock(jsoncConfig, "json", providerId);
      expect(block).not.toBeNull();

      const next = removeProviderBlock(jsoncConfig, block!, "json");
      const jsonWithoutComments = next
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      expect(() => JSON.parse(jsonWithoutComments)).not.toThrow();
      expect(next).not.toContain(`\"${providerId}\"`);
      expect(next).toContain('"providers": {');
      for (const [id, url] of Object.entries(urls)) {
        if (id === providerId) {
          expect(next).not.toContain(url);
        } else {
          expect(next).toContain(url);
        }
      }
    }
  });
});
