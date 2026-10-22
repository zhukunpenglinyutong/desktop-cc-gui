import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCreatorSkillFiles,
  CREATOR_SKILL_DIR,
  repoRootFromHere,
} from "./creator-skill-docs";

/**
 * SDK 漂移门禁：内置插件开发 skill（= 插件作者与 AI 看到的说明书）里由脚本
 * 生成的部分必须与 SDK + 宿主门禁源码逐字节一致；手写的 SKILL.md 则把
 * 「manifest 硬性校验规则」锚定到宿主真实校验器上（正则不同即失败）。
 *
 * 任何一侧改了没重新生成/没同步，本测试即失败并把修复命令写进断言消息。
 */
const repoRoot = repoRootFromHere();
const skillDir = path.join(repoRoot, CREATOR_SKILL_DIR);
const regenerate = "运行 `pnpm plugin-skill:docs` 重新生成（SDK/扩展点/权限改了必须跑）";

const skillMd = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");

describe("内置插件开发 skill", () => {
  it.each(buildCreatorSkillFiles(repoRoot))(
    "$path 与源码生成结果一致",
    ({ path: rel, content }) => {
      const target = path.join(skillDir, rel);
      expect(existsSync(target), `${rel} 不存在：${regenerate}`).toBe(true);
      expect(readFileSync(target, "utf8"), `${rel} 已过期：${regenerate}`).toBe(content);
    },
  );

  it("SKILL.md 带 CLI 可发现的 frontmatter（name + description）", () => {
    const frontmatter = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    expect(frontmatter, "SKILL.md 缺少 frontmatter，CLI 不会注册该 skill").not.toBeNull();
    const meta = frontmatter![1]!;
    expect(meta).toMatch(/^name:\s*ccgui-plugin-creator\s*$/m);
    expect(meta).toMatch(/^description:\s*\S+/m);
    // 单行 description：CLI 的 frontmatter 解析是逐行 `key: value`，
    // 折行的描述会被截断成半句话。
    const description = meta.match(/^description:\s*(.+)$/m)![1]!;
    expect(description.startsWith("|") || description.startsWith(">")).toBe(false);
  });

  it("SKILL.md 抄的 manifest 校验规则与宿主校验器一致", () => {
    // 宿主侧加载前校验（runtime/permissions.ts::validateManifest）是硬边界；
    // skill 里写给 AI 的规则必须是同一组正则，改了校验器就得同步改文案。
    const validator = readFileSync(
      path.join(repoRoot, "src/features/plugins/runtime/permissions.ts"),
      "utf8",
    );
    const literals = (validator.match(/\/\^[^/\n]+\//g) ?? []).map((l) => l.slice(1, -1));
    expect(literals.length, "没能在 validateManifest 里找到规则正则，请同步本测试与 SKILL.md").toBeGreaterThanOrEqual(2);
    for (const body of literals) {
      expect(skillMd, `SKILL.md 未声明校验规则 ${body}`).toContain(body);
    }
    for (const tier of ["declarative", "js"]) {
      expect(skillMd, `SKILL.md 未声明 tier 取值 ${tier}`).toContain(tier);
    }
  });

  it("SKILL.md 里 manifest 示例覆盖全部必填字段", () => {
    const sdkDoc = buildCreatorSkillFiles(repoRoot).find((f) => f.path.endsWith("sdk-api.md"))!.content;
    const required = sdkDoc
      .split("\n")
      .filter((line) => line.startsWith("| `") && line.includes("| 必填 |"))
      .map((line) => line.match(/^\| `([^`?]+)`/)![1]!);
    expect(required, "生成物没有必填字段行，检查 sdk-api.md 的 manifest 表").toContain("id");
    // 字段可以写在 prop 表里（`name`）或示例 JSON 里（"name"）：两种形式都算已说明。
    const mentions = (field: string) =>
      skillMd.includes("`" + field + "`") || skillMd.includes('"' + field + '"');
    for (const field of required) {
      expect(mentions(field), `SKILL.md 的 manifest 说明缺少必填字段 ${field}`).toBe(true);
    }
  });

  it("生成物不含时间戳一类的非确定字段", () => {
    const sdkDoc = buildCreatorSkillFiles(repoRoot).find((f) => f.path.endsWith("sdk-api.md"));
    expect(sdkDoc, "sdk-api.md 生成物缺失").toBeDefined();
    expect(sdkDoc!.content).not.toMatch(/20\d\d-\d\d-\d\dT\d\d:/);
  });
});
