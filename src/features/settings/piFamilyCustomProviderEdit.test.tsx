// Inline name / baseUrl editing on the 自定义供应商 rows: the row pencils open
// a one-line field editor, and committing writes the whole models.yml back
// through the backend with only that field rewritten.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { read, write } = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(async (_engine: string, _text: string): Promise<void> => {}),
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    piFamilyAuthList: async () => ({
      store: { path: "/tmp/auth.json", kind: "authJson", exists: true },
      providers: [],
      oauthProviders: [],
    }),
    piFamilyModelsConfigRead: () => read(),
    piFamilyModelsConfigWrite: write,
  },
}));

import i18n from "@/lib/i18n";
import { PiFamilyAuthSection } from "./PiFamilyAuthSection";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MODELS_YML = `providers:
  first:
    baseUrl: https://first.example
    models:
      - id: first-model

  target:
    baseUrl: https://target.example
    models:
      - id: target-model
  last:
    baseUrl: https://last.example
`;

function modelsConfig(text: string) {
  return {
    file: { path: "/tmp/models.yml", format: "yaml" as const, exists: true },
    text,
    template: "",
    providers: [
      { id: "first", name: null, baseUrl: "https://first.example", api: null, modelCount: 1, hasApiKey: false },
      { id: "target", name: null, baseUrl: "https://target.example", api: null, modelCount: 1, hasApiKey: false },
      { id: "last", name: null, baseUrl: "https://last.example", api: null, modelCount: 1, hasApiKey: false },
    ],
    parseError: null,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  read.mockReset();
  write.mockClear();
  read.mockImplementation(async () => modelsConfig(MODELS_YML));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** The row whose provider id (or name) is `label`. */
function rowOf(label: string): HTMLElement {
  const row = [...container.querySelectorAll<HTMLElement>("div")].find(
    (el) =>
      el.className.includes("min-h-[52px]") &&
      (el.textContent ?? "").includes(label),
  );
  if (!row) throw new Error(`provider row not rendered: ${label}`);
  return row;
}

function pencilOf(label: string, titleKey: string): HTMLButtonElement {
  const row = rowOf(label);
  const button = [...row.querySelectorAll<HTMLButtonElement>("button")].find(
    (el) => el.getAttribute("aria-label") === i18n.t(titleKey, { name: label }),
  );
  if (!button) throw new Error(`pencil not rendered for ${label} / ${titleKey}`);
  return button;
}

async function render() {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <PiFamilyAuthSection engine="omp" />
      </MemoryRouter>,
    );
  });
}

/** React tracks input values on the node itself, so a plain `.value =` write
 *  is swallowed as a no-op. Go through the prototype setter, then dispatch the
 *  input event React listens for. */
async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(input: HTMLInputElement, key: string) {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

function fieldInput(name: string, titleKey: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="' + i18n.t(titleKey, { name }) + '"]',
  );
  if (!input) throw new Error(`field input not rendered for ${name}`);
  return input;
}

describe("PiFamilyAuthSection custom provider inline edit", () => {
  it("renames the provider key from the row pencil and writes it back", async () => {
    await render();

    await act(async () => {
      pencilOf("target", "settings.piAuthCustomEditName").click();
    });

    const input = fieldInput("target", "settings.piAuthCustomEditName");
    expect(input.value).toBe("target");

    await typeInto(input, "胖猫pangmao");
    await press(input, "Enter");

    expect(write).toHaveBeenCalledTimes(1);
    const [engine, text] = write.mock.calls[0];
    expect(engine).toBe("omp");
    expect(text).toContain("  胖猫pangmao:\n    baseUrl: https://target.example");
    expect(text).not.toContain("  target:");
    expect(text).toContain("  first:");
    expect(text).toContain("  last:");
  });

  it("refuses a rename that collides with another provider", async () => {
    await render();

    await act(async () => {
      pencilOf("target", "settings.piAuthCustomEditName").click();
    });
    const input = fieldInput("target", "settings.piAuthCustomEditName");
    await typeInto(input, "first");
    await press(input, "Enter");

    expect(write).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      i18n.t("settings.piAuthCustomFieldDuplicateId", { id: "first" }),
    );
  });

  it("refuses an empty name and leaves the file untouched", async () => {
    await render();

    await act(async () => {
      pencilOf("target", "settings.piAuthCustomEditName").click();
    });
    const input = fieldInput("target", "settings.piAuthCustomEditName");
    await typeInto(input, "   ");
    await press(input, "Enter");

    expect(write).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      i18n.t("settings.piAuthCustomFieldEmptyId"),
    );
  });

  it("rewrites baseUrl without touching the other providers", async () => {
    await render();

    await act(async () => {
      pencilOf("target", "settings.piAuthCustomEditUrl").click();
    });
    const input = fieldInput("target", "settings.piAuthCustomEditUrl");
    expect(input.value).toBe("https://target.example");

    await typeInto(input, "https://next.example/v1");
    await press(input, "Enter");

    const text = write.mock.calls[0][1];
    expect(text).toContain("baseUrl: https://next.example/v1");
    expect(text).not.toContain("https://target.example");
    expect(text).toContain("https://first.example");
    expect(text).toContain("https://last.example");
  });

  it("refuses an empty baseUrl and leaves the file untouched", async () => {
    await render();

    await act(async () => {
      pencilOf("target", "settings.piAuthCustomEditUrl").click();
    });
    const input = fieldInput("target", "settings.piAuthCustomEditUrl");
    await typeInto(input, "   ");
    await press(input, "Enter");

    expect(write).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      i18n.t("settings.piAuthCustomFieldEmptyUrl"),
    );
  });

  it("Escape cancels without writing", async () => {
    await render();

    await act(async () => {
      pencilOf("last", "settings.piAuthCustomEditName").click();
    });
    await press(fieldInput("last", "settings.piAuthCustomEditName"), "Escape");

    expect(write).not.toHaveBeenCalled();
    expect(
      container.querySelector(
        'input[aria-label="' + i18n.t("settings.piAuthCustomEditName", { name: "last" }) + '"]',
      ),
    ).toBeNull();
    expect(rowOf("last").textContent).toContain("last");
  });

  it("keeps the key as the row label even when a stray name field exists", async () => {
    read.mockImplementation(async () => {
      const config = modelsConfig(MODELS_YML);
      return {
        ...config,
        text: config.text.replace("  target:\n", "  target:\n    name: 别名\n"),
        providers: config.providers.map((provider) =>
          provider.id === "target" ? { ...provider, name: "别名" } : provider,
        ),
      };
    });
    await render();

    // omp ignores a provider-level `name`, so the row must show (and edit) the
    // key rather than a label the CLI never reads.
    const row = rowOf("target");
    expect(row.textContent).not.toContain("别名");
    await act(async () => {
      pencilOf("target", "settings.piAuthCustomEditName").click();
    });
    const input = fieldInput("target", "settings.piAuthCustomEditName");
    expect(input.value).toBe("target");

    await typeInto(input, "renamed");
    await press(input, "Enter");

    const text = write.mock.calls[0][1];
    expect(text).toContain("  renamed:\n    name: 别名");
    expect(text).not.toContain("  target:");
  });
});
