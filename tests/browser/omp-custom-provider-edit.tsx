// Open /tests/browser/omp-custom-provider-edit.html with the Vite dev server
// running. Renders the real PiFamilyAuthSection (omp) against a mocked
// models.yml so the row pencils added for 自定义供应商 can be exercised: the
// name / URL pencil opens a one-line editor, committing writes the whole file
// back, and the pencil must be sized in `em` so it tracks the row's font.
// No app, no backend, no real config file.
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "../../src/index.css";
import "../../src/lib/i18n";
import { PiFamilyAuthSection } from "../../src/features/settings/PiFamilyAuthSection";

interface Fixture {
  text(): string;
  writes(): string[];
  lineOf(id: string, field: string): string | null;
  idOf(needle: string): string | null;
  reset(): void;
}

/** The harness page installs this before the module runs; a missing fixture
 *  means the page was opened without its inline IPC stub. */
function requireFixture(): Fixture {
  const candidate: unknown = (window as Window & { __fixture?: unknown }).__fixture;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    !("lineOf" in candidate) ||
    typeof candidate.lineOf !== "function"
  ) {
    throw new Error("__fixture missing: open omp-custom-provider-edit.html");
  }
  return candidate as Fixture;
}

const fixture = requireFixture();

function readout(): string {
  const row = (needle: string) => {
    const id = fixture.idOf(needle);
    return id
      ? `  key=${id} url=${fixture.lineOf(id, "baseUrl") ?? "(none)"}`
      : `  (missing) ${needle}`;
  };
  return [
    "models.yml",
    row("ai.venlacy.com"),
    row("api.123nhh.com"),
    row("fb2api.yuzu.gv.uy"),
    "",
    `writes=${fixture.writes().length}`,
  ].join("\n");
}

const pre = document.createElement("pre");
pre.id = "readout";
pre.style.cssText =
  "position:fixed;top:0;left:0;z-index:50;margin:0;padding:6px;color:#7dd3fc;background:rgba(0,0,0,.75);font:11px monospace;white-space:pre";
document.body.appendChild(pre);

declare global {
  interface Window {
    __refreshReadout: () => void;
  }
}

window.__refreshReadout = () => {
  pre.textContent = readout();
};

function Fixture() {
  return (
    <div className="mx-auto mt-6 w-[1120px]">
      <div className="flex h-[640px] flex-col overflow-clip rounded-3xl bg-background-full">
        <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8 pt-8">
          <div className="mx-auto w-full max-w-[720px]">
            <PiFamilyAuthSection engine="omp" />
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("fixture")!).render(
  <MemoryRouter>
    <Fixture />
  </MemoryRouter>,
);
setTimeout(() => window.__refreshReadout(), 400);
document.addEventListener("keyup", () => setTimeout(() => window.__refreshReadout(), 60));
document.addEventListener("click", () => setTimeout(() => window.__refreshReadout(), 60));
