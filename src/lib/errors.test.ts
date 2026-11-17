import { expect, it } from "vitest";
import i18n from "./i18n";
import { errorText } from "./errors";

it("localizes provider migration conflicts from native and web errors", async () => {
  const path = "D:\\配置\\config.toml";
  const backup = "D:\\备份\\config.toml";
  const message = "CCGUI_PROVIDER_MIGRATION_CONFLICT:" + JSON.stringify({ path, backup });
  await i18n.changeLanguage("zh");
  expect(errorText(message)).toContain("旧版渠道配置无法自动恢复");
  expect(errorText(message)).toContain(path);
  await i18n.changeLanguage("en");
  expect(errorText(new Error(message))).toContain("Both files have been preserved");
  expect(errorText(new Error(message))).toContain(backup);
});

it("preserves unknown and malformed errors", () => {
  expect(errorText("CCGUI_PROVIDER_MIGRATION_CONFLICT:invalid")).toBe("CCGUI_PROVIDER_MIGRATION_CONFLICT:invalid");
  expect(errorText(new Error("disk full"))).toBe("disk full");
});

it("distinguishes git ownership failures from a missing repository", async () => {
  await i18n.changeLanguage("zh");
  const unsafe = errorText("GIT_UNSAFE_REPO:repository path 'C:/x' is not owned by current user");
  expect(unsafe).toContain("所有权不受信任");
  expect(unsafe).toContain("safe.directory");
  expect(unsafe).toContain("C:/x");
  const open = errorText("GIT_OPEN_FAILED:path too long");
  expect(open).toContain("无法打开 Git 仓库");
  expect(open).toContain("path too long");
  await i18n.changeLanguage("en");
  expect(errorText("GIT_UNSAFE_REPO:x")).toContain("safe.directory");
  expect(errorText("GIT_OPEN_FAILED:x")).toContain("Could not open the git repository");
});

it("localizes a rename that did not update any session", async () => {
  await i18n.changeLanguage("zh");
  expect(errorText("CCGUI_SESSION_NOT_FOUND")).toContain("未能保存名称");
  await i18n.changeLanguage("en");
  expect(errorText(new Error("CCGUI_SESSION_NOT_FOUND"))).toContain("The name was not saved");
});
