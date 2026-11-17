import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../../src/lib/i18n";
import { CliMenu } from "../../src/components/application/ai-chat/cli-menu";
import { MOBILE_MEDIA } from "../../src/hooks/use-media-query";

const models = [
  { id: "relay/deepseek-v4-pro", label: "deepseek-v4-pro" },
  { id: "relay/deepseek-v4.1-flash", label: "deepseek-v4.1-flash" },
  { id: "relay/long", label: "自定义中文模型🧠-" + "deepseek-v4.1-flash-".repeat(6), description: "完整说明：" + "渠道模型描述".repeat(12) },
];
// Short names keep the panel at its 320px floor: against the 480px cap a
// channel name widening the flyout would go unnoticed.
const claudeModels = [{ id: "sonnet", label: "sonnet" }, { id: "opus", label: "opus" }];
const channels = [
  { id: "short", label: "short-relay" },
  { id: "long", label: "超长渠道-" + "very-long-channel-name-".repeat(6) },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const frames = async () => {
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
};
const flyoutEl = () => document.querySelector<HTMLElement>("[data-engine-flyout]")!;
const flyoutWidth = () => flyoutEl().getBoundingClientRect().width;
/** Names clipped in their own box or overflowing their row or list. The 1px
 *  slack absorbs scrollWidth rounding. */
const cutNames = () =>
  [...flyoutEl().querySelectorAll<HTMLElement>('[role="radiogroup"], [role="radio"], [role="radio"] span')]
    .filter((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
    .map((el) => el.textContent?.slice(0, 24));
const typeInto = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

/** Open state: every name readable, panel clear of the window edges. */
function checkOpened() {
  const box = flyoutEl().getBoundingClientRect();
  const leftGap = box.left;
  const rightGap = window.innerWidth - box.right;
  const cut = cutNames();
  return { pass: cut.length === 0 && leftGap >= 15.5 && rightGap >= 15.5, width: box.width, leftGap, rightGap, cut };
}

/** Filtering away the widest row must not resize the panel or shift the field
 *  sideways. Vertical movement is expected: the panel is bottom-anchored. */
async function checkSearch() {
  const fields = flyoutEl().querySelectorAll<HTMLInputElement>('input:not([type="range"])');
  const search = fields[fields.length - 1];
  const before = { width: flyoutWidth(), x: search.getBoundingClientRect().x };
  typeInto(search, "v4-pro");
  await frames();
  const longRowHidden = !flyoutEl().textContent?.includes("自定义中文模型");
  const widthDelta = Math.abs(flyoutWidth() - before.width);
  const shift = Math.abs(search.getBoundingClientRect().x - before.x);
  typeInto(search, "");
  await frames();
  return { pass: longRowHidden && widthDelta <= 1 && shift <= 1, longRowHidden, widthDelta, shift };
}

/** Opening the channel list or picking a long channel must not resize the panel. */
async function checkChannels() {
  [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button[aria-pressed]')]
    .find((row) => row.textContent?.includes("Claude Code"))!
    .click();
  await frames();
  const collapsed = flyoutWidth();
  const trigger = () => flyoutEl().querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  trigger().click();
  await frames();
  const openedDelta = Math.abs(flyoutWidth() - collapsed);
  const openedCut = cutNames();
  [...flyoutEl().querySelectorAll<HTMLButtonElement>('[role="radio"]')]
    .find((row) => row.textContent?.includes("超长渠道"))!
    .click();
  await frames();
  const pickedDelta = Math.abs(flyoutWidth() - collapsed);
  const pickedTitle = trigger().querySelector<HTMLElement>("[title]")?.title.includes("超长渠道") ?? false;
  return {
    pass: collapsed <= 321 && openedDelta <= 1 && pickedDelta <= 1 && openedCut.length === 0 && pickedTitle,
    collapsed, openedDelta, pickedDelta, openedCut, pickedTitle,
  };
}

async function selfCheck() {
  const report = (result: object) => {
    document.querySelector("#result")!.textContent = JSON.stringify(result, null, 2);
  };
  // Narrow windows have no flyout: CliMenu uses a modal there, checked by hand.
  if (window.matchMedia(MOBILE_MEDIA).matches) {
    report({ status: "SKIP", reason: "no flyout below the md breakpoint" });
    return;
  }
  try {
    await document.fonts.ready;
    document.querySelector<HTMLButtonElement>("[data-trigger] button")!.click();
    // Measure the settled panel: the popover enters at 95% scale.
    await sleep(500);
    const opened = checkOpened();
    const search = await checkSearch();
    const channel = await checkChannels();
    const pass = opened.pass && search.pass && channel.pass;
    report({ status: pass ? "PASS" : "FAIL", opened, search, channel });
  } catch (error) {
    report({ status: "FAIL", error: String(error) });
  } finally {
    // Hand the page back for the manual checks.
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  }
}

function Fixture() {
  const [model, setModel] = useState(models[2].id);
  const [channel, setChannel] = useState(channels[0].id);
  const [right, setRight] = useState(new URLSearchParams(location.search).get("side") !== "left");
  useEffect(() => {
    void selfCheck();
  }, []);
  return (
    <main className="p-4">
      <button onClick={() => setRight(!right)}>切换入口位置</button>
      <p>合成模型数据；点击入口检查完整名称、换行、选择及窗口边界。</p>
      <output>{model}</output>
      <pre id="result" className="whitespace-pre-wrap [overflow-wrap:anywhere]">Running…</pre>
      <div data-trigger className={`fixed bottom-8 flex max-w-[calc(100vw-32px)] items-center gap-2 ${right ? "right-4" : "left-4"}`}>
        <CliMenu
          options={[
            { id: "pi", label: "PI", available: true },
            { id: "claude", label: "Claude Code", available: true },
          ]}
          value="pi" onChange={() => {}}
          modelsByEngine={{ pi: models, claude: claudeModels }}
          models={{ pi: model, claude: claudeModels[0].id }}
          onModelChange={(engine, id) => { if (engine === "pi") setModel(id); }}
          efforts={{}} onEffortChange={() => {}}
          channelsByEngine={{ claude: channels }}
          selectedChannels={{ claude: channel }}
          onChannelChange={(_, id) => setChannel(id)}
          ompServiceTier={null} onOmpServiceTierChange={async () => {}}
          codexServiceTier={null} onCodexServiceTierChange={async () => {}}
        />
        <button className="shrink-0">发送</button>
      </div>
    </main>
  );
}

createRoot(document.getElementById("fixture")!).render(<Fixture />);
