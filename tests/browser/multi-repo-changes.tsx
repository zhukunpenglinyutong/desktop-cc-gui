// Open /tests/browser/multi-repo-changes.html with the Vite dev server running.
// The reported gap: a workspace folder holding several independent projects
// showed only one of them. This fixture mounts the production ChangesPanel
// over a three-project workspace (one staged-only, one unstaged + untracked,
// one clean) and checks the layout properties a jsdom test cannot see — that
// every project gets its own section and commit box inside ONE scroller, that
// each section's actions target its own repository, and that folding one
// project leaves the others where they were. Store actions that would invoke
// Tauri IPC are stubbed. No app, no backend.
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../../src/lib/i18n";
import { ChangesPanel } from "../../src/features/git/ChangesPanel";
import { useGitStore } from "../../src/features/git/store";
import { useFilesStore } from "../../src/features/files/store";
import type { GitStatus, RepositorySummary } from "../../src/lib/ipc";

localStorage.setItem("ccgui-next.language", "zh");

function sleep(ms: number) {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function fail(reason: string): never {
  throw new Error(reason);
}

const WORKSPACE = "/tmp/multi-repo-fixture";

/** Discovery output: the workspace root is NOT itself a repository, so the
 *  projects are the whole list. */
const repos: RepositorySummary[] = [
  { path: `${WORKSPACE}/api`, branch: "main", changed: 1, untracked: 0 },
  { path: `${WORKSPACE}/web`, branch: "feat/ui", changed: 1, untracked: 1 },
  { path: `${WORKSPACE}/docs`, branch: "main", changed: 0, untracked: 0 },
];

function statusFor(path: string): GitStatus {
  if (path.endsWith("/api")) {
    return {
      branch: "main",
      staged: [{ path: "src/api.txt", status: "M", additions: 3, deletions: 1 }],
      unstaged: [],
      untracked: [],
    };
  }
  if (path.endsWith("/web")) {
    return {
      branch: "feat/ui",
      staged: [],
      unstaged: [{ path: "src/web.txt", status: "M", additions: 5, deletions: 2 }],
      untracked: [{ path: "src/new.txt", status: "??", additions: 72, deletions: 0 }],
    };
  }
  return { branch: "main", staged: [], unstaged: [], untracked: [] };
}

const stageCalls: string[] = [];
const commitCalls: string[] = [];

useGitStore.setState({
  reposByWorkspace: { [WORKSPACE]: repos },
  reposFetchedAtByWorkspace: { [WORKSPACE]: Date.now() },
  statusByWorkspace: Object.fromEntries(repos.map((r) => [r.path, statusFor(r.path)])),
  branchesByWorkspace: Object.fromEntries(repos.map((r) => [r.path, [{ name: r.branch }]])),
  // Discovery would invoke Tauri IPC; the summaries above are its result.
  discoverRepos: () => Promise.resolve(),
  refresh: () => Promise.resolve(),
  loadBranches: () => Promise.resolve(),
  stage: (workspacePath: string, files: string[]) => {
    stageCalls.push(`${workspacePath}::${files.join(",")}`);
    return Promise.resolve();
  },
  commit: (workspacePath: string, message: string) => {
    commitCalls.push(`${workspacePath}::${message}`);
    return Promise.resolve("sha");
  },
});
// The panel follows the file tree only when it is not pinned; a selection
// would steer it into a single repository.
useFilesStore.setState({ selectedPath: null, repositories: {} });

/** Project sections are the scroller's direct children; each project's
 *  staged/unstaged/untracked groups are nested `<section>`s inside them. */
function projectSections(): HTMLElement[] {
  const scroller = document.querySelector("aside > div")!;
  return Array.from(scroller.children).filter(
    (child): child is HTMLElement => child.tagName === "SECTION",
  );
}

/** Section header buttons carry the project folder name. */
function sectionFor(name: string): HTMLElement {
  const header = projectSections()
    .map((section) => section.querySelector(":scope > button"))
    .find((button) => button?.textContent?.includes(name));
  if (!header) fail(`section for ${name} not rendered`);
  return header as HTMLElement;
}

async function press(el: Element) {
  el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  (el as HTMLElement).click();
  await sleep(50);
}

async function main() {
  const root = createRoot(document.getElementById("root")!);
  root.render(
    <div style={{ width: 360, height: 520, display: "flex" }}>
      <ChangesPanel workspacePath={WORKSPACE} className="flex-1" />
    </div>,
  );
  await sleep(300);

  const sections = projectSections();
  // 1. One section per project, in discovery order, named after its folder.
  if (sections.length !== 3) fail(`expected 3 project sections, got ${sections.length}`);
  const labels = sections.map(
    (s) => s.querySelector(":scope > button > span")?.textContent?.trim() ?? "",
  );
  if (labels.join(",") !== "api,web,docs") {
    fail(`sections read ${labels.join(",")}`);
  }

  // 2. Every project's rows live in ONE scroller, the way IDEA walks its
  //    whole change list: a single scrollbar, not one per project.
  const scrollers = Array.from(document.querySelectorAll("aside div")).filter((el) => {
    const overflow = getComputedStyle(el).overflowY;
    return (overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight;
  });
  if (scrollers.length !== 1) fail(`expected one scrolling list, got ${scrollers.length}`);
  const scroller = scrollers[0];

  // The clean repository is lazy: first expansion creates its panel.
  if (sections[2].querySelector("textarea")) fail("clean repository was not loaded lazily");
  await press(sectionFor("docs"));
  await sleep(220);

  // 3. Per-project commit boxes: the staged-only project offers a live commit
  //    button, the clean one is disabled, and each sits inside its own
  //    section rather than a single panel-wide footer.
  const footers = Array.from(document.querySelectorAll("aside textarea"));
  if (footers.length !== 3) fail(`expected a commit box per project, got ${footers.length}`);
  for (const [index, project] of ["api", "web", "docs"].entries()) {
    if (!sections[index].contains(footers[index])) {
      fail(`${project}'s commit box is not inside its own section`);
    }
  }

  // 4. Row actions are scoped to the repository that owns the row. `web` is
  //    the only project with worktree changes — one unstaged row and one
  //    untracked row, so exactly two stage actions, both targeting `web`.
  const stageButtons = ["src/web.txt", "src/new.txt"].map((path) => {
    const row = sections[1].querySelector(`input[aria-label="${path}"]`)?.closest("li");
    const button = row?.querySelector('button[aria-label="暂存"]');
    if (!button) fail(`missing file stage action for ${path}`);
    return button;
  });
  for (const button of stageButtons) await press(button);
  if (stageCalls.length !== 2) fail(`expected 2 stage calls, got ${stageCalls.length}`);
  for (const call of stageCalls) {
    if (!call.startsWith(`${WORKSPACE}/web::`)) {
      fail(`stage targeted the wrong project: ${call}`);
    }
  }
  // api is staged-only, so it offers unstage, never stage.
  if (sections[0].querySelector('button[aria-label="暂存"]')) {
    fail("api renders a stage action despite having nothing unstaged");
  }

  // 5. Scrolling reaches the last project's commit box — the shared scroller
  //    really does walk every project, instead of stopping at the first.
  scroller.scrollTop = scroller.scrollHeight;
  await sleep(80);
  const docsFooter = footers[2].getBoundingClientRect();
  const asideBox = document.querySelector("aside")!.getBoundingClientRect();
  if (docsFooter.top > asideBox.bottom) {
    fail(`the last project is unreachable by scrolling (top ${docsFooter.top}, panel ${asideBox.bottom})`);
  }

  // 6. Folding one project hides only that project's body. Folding api must
  //    preserve its draft and DOM identity while making its body inaccessible.
  const apiHeader = sectionFor("api");
  const apiDraft = sections[0].querySelector("textarea")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setValue.call(apiDraft, "fix: preserve my draft");
  apiDraft.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(50);
  await press(apiHeader);
  await sleep(220);
  const hiddenBody = sections[0].querySelector<HTMLElement>('[aria-hidden="true"][inert]');
  if (!hiddenBody) fail("folding api did not remove its body from keyboard and accessibility navigation");
  if (apiDraft.getBoundingClientRect().height > 0 && hiddenBody.getBoundingClientRect().height > 1) {
    fail("folding api left its body visible in the layout");
  }
  if (!sections[1].querySelector("li")) fail("folding api also removed web's rows");
  await press(apiHeader);
  await sleep(220);
  if (!sections[0].querySelector("li")) fail("re-opening api did not restore its rows");
  if (sections[0].querySelector("textarea") !== apiDraft || apiDraft.value !== "fix: preserve my draft") {
    fail("folding api discarded its draft or recreated its input");
  }

  document.getElementById("readout")!.textContent =
    `PASS sections=${sections.length} scrollers=${scrollers.length} ` +
    `stage=${stageCalls.join("|")}`;
}

main().catch((error) => {
  document.getElementById("readout")!.textContent = `FAIL: ${String(error)}`;
});
