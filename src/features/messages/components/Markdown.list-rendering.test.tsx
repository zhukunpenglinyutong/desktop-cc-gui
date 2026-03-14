// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

describe("Markdown list rendering", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps ordered lists when items are indented with one to three spaces", () => {
    const value = [
      "第二步：触发发布（每次发版）",
      "",
      "方法 A：网页操作（推荐，不懂代码也能用）：",
      "",
      " 1. 访问：https://github.com/Dimillian/CodexMonitor/actions",
      " 2. 点击左侧 \"Release\" 工作流",
      " 3. 点击右上角 \"Run workflow\" 按钮",
      " 4. 选择分支（main）",
      " 5. 点击绿色 \"Run workflow\" 确认",
    ].join("\n");

    const { container } = render(<Markdown value={value} className="markdown" />);

    const orderedLists = container.querySelectorAll("ol");
    expect(orderedLists).toHaveLength(1);
    expect(orderedLists[0]?.querySelectorAll(":scope > li")).toHaveLength(5);
  });

  it("renders ordered steps and keeps following checklist bullets as unordered", () => {
    const value = [
      "第二步：触发发布（每次发版）",
      "",
      "方法 A：网页操作（推荐，不懂代码也能用）：",
      "",
      "1. 访问：https://github.com/Dimillian/CodexMonitor/actions",
      "2. 点击左侧 \"Release\" 工作流",
      "3. 点击右上角 \"Run workflow\" 按钮",
      "4. 选择分支（main）",
      "5. 点击绿色 \"Run workflow\" 确认",
      "",
      "等待 15-30 分钟，系统会自动：",
      "",
      "- ✅ 构建 macOS、Windows、Linux（x64 + ARM64）版本",
      "- ✅ 签名和公证 macOS 应用",
      "- ✅ 创建 GitHub Release 并上传所有安装包",
    ].join("\n");

    const { container } = render(<Markdown value={value} className="markdown" />);

    const orderedLists = container.querySelectorAll("ol");
    const unorderedLists = container.querySelectorAll("ul");
    expect(orderedLists).toHaveLength(1);
    expect(unorderedLists).toHaveLength(1);
    expect(orderedLists[0]?.querySelectorAll(":scope > li")).toHaveLength(5);
    expect(unorderedLists[0]?.querySelectorAll(":scope > li")).toHaveLength(3);
  });

  it("keeps decimal markers for ordered lists", () => {
    const value = [
      "步骤：",
      "",
      "1. 第一项",
      "2. 第二项",
      "3. 第三项",
    ].join("\n");

    const { container } = render(<Markdown value={value} className="markdown" />);

    const ordered = container.querySelector("ol");
    expect(ordered).toBeTruthy();
    expect(ordered?.querySelectorAll(":scope > li")).toHaveLength(3);
    expect(container.querySelector("ul")).toBeNull();
  });

  it("keeps nested bullet items under ordered steps for chat-formatted content", () => {
    const value = [
      "1. 第一步",
      " - 先做检查",
      " - 再继续处理",
      "2. 第二步",
    ].join("\n");

    const { container } = render(<Markdown value={value} className="markdown" />);

    const ordered = container.querySelector("ol");
    const nestedList = ordered?.querySelector("li ul");
    expect(ordered?.querySelectorAll(":scope > li")).toHaveLength(2);
    expect(nestedList?.querySelectorAll(":scope > li")).toHaveLength(2);
  });

  it("normalizes compact ordered markers without whitespace", () => {
    const value = [
      "架构特征：",
      "1.三层结构：Controller -> Service -> Domain Record",
      "2.无 Repository 层",
      "3.内存存储",
    ].join("\n");

    const { container } = render(<Markdown value={value} className="markdown" />);

    const ordered = container.querySelector("ol");
    expect(ordered).toBeTruthy();
    expect(ordered?.querySelectorAll(":scope > li")).toHaveLength(3);
  });

  it("splits sentence-attached ordered markers into markdown list rows", () => {
    const value = [
      "根据系统提示，我可以看到：1.当前工作目录是 /tmp/demo",
      "2.这是一个 git 仓库",
      "3.最近用户输入是“项目分析”",
    ].join("\n");

    const { container } = render(<Markdown value={value} className="markdown" />);

    const ordered = container.querySelector("ol");
    expect(ordered).toBeTruthy();
    expect(ordered?.querySelectorAll(":scope > li")).toHaveLength(3);
  });
});
