import { describe, expect, it } from "vitest";
import { stripComposerKanbanTagsPreserveFormatting } from "./useAppShellSections";

describe("stripComposerKanbanTagsPreserveFormatting", () => {
  it("keeps multiline formatting when no kanban tag is present", () => {
    const input = "你好\n我是陈湘宁!!";
    expect(stripComposerKanbanTagsPreserveFormatting(input)).toBe(input);
  });

  it("removes kanban tags without collapsing line breaks", () => {
    const input = "第一行\n&@看板A 第二行\n第三行";
    expect(stripComposerKanbanTagsPreserveFormatting(input)).toBe("第一行\n第二行\n第三行");
  });

  it("preserves CRLF line endings when removing kanban tags", () => {
    const input = "第一行\r\n&@看板A 第二行\r\n第三行";
    expect(stripComposerKanbanTagsPreserveFormatting(input)).toBe("第一行\r\n第二行\r\n第三行");
  });

  it("collapses only redundant spaces caused by removed tags", () => {
    const input = "任务 &@看板A   描述";
    expect(stripComposerKanbanTagsPreserveFormatting(input)).toBe("任务 描述");
  });

  it("remains stable across repeated calls with and without tags", () => {
    expect(stripComposerKanbanTagsPreserveFormatting("&@看板A 第一行")).toBe("第一行");
    expect(stripComposerKanbanTagsPreserveFormatting("第二行")).toBe("第二行");
    expect(stripComposerKanbanTagsPreserveFormatting("&@看板B 第三行")).toBe("第三行");
  });
});
