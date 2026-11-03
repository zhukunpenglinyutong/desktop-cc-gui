import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../../src/lib/i18n";
import { CliMenu } from "../../src/components/application/ai-chat/cli-menu";

const models = [
  { id: "relay/deepseek-v4-pro", label: "deepseek-v4-pro" },
  { id: "relay/deepseek-v4.1-flash", label: "deepseek-v4.1-flash" },
  { id: "relay/long", label: "自定义中文模型🧠-" + "deepseek-v4.1-flash-".repeat(6), description: "完整说明：" + "渠道模型描述".repeat(12) },
];

function Fixture() {
  const [model, setModel] = useState(models[2].id);
  const [right, setRight] = useState(true);
  return (
    <main className="p-4">
      <button onClick={() => setRight(!right)}>切换入口位置</button>
      <p>合成模型数据；点击入口检查完整名称、换行、选择及窗口边界。</p>
      <output>{model}</output>
      <div className={`fixed bottom-8 flex max-w-[calc(100vw-32px)] items-center gap-2 ${right ? "right-4" : "left-4"}`}>
        <CliMenu
          options={[{ id: "pi", label: "PI", available: true }]}
          value="pi" onChange={() => {}}
          modelsByEngine={{ pi: models }} models={{ pi: model }}
          onModelChange={(_, id) => setModel(id)}
          efforts={{}} onEffortChange={() => {}}
          ompServiceTier={null} onOmpServiceTierChange={async () => {}}
          codexServiceTier={null} onCodexServiceTierChange={async () => {}}
        />
        <button className="shrink-0">发送</button>
      </div>
    </main>
  );
}

createRoot(document.getElementById("fixture")!).render(<Fixture />);
