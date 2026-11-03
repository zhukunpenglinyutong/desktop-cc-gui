import { describe, expect, it } from "vitest";
import { formatInstallCount } from "./install-count";

describe("formatInstallCount", () => {
  it("keeps counts below the 1K rounding threshold verbatim", () => {
    expect(formatInstallCount(0)).toBe("0");
    expect(formatInstallCount(47)).toBe("47");
    expect(formatInstallCount(949)).toBe("949");
  });

  it("rounds to one-decimal thousands from 950 up, dropping a .0 tail", () => {
    expect(formatInstallCount(950)).toBe("1K");
    expect(formatInstallCount(980)).toBe("1K");
    expect(formatInstallCount(999)).toBe("1K");
    expect(formatInstallCount(1000)).toBe("1K");
    expect(formatInstallCount(1049)).toBe("1K");
    expect(formatInstallCount(1050)).toBe("1.1K");
    expect(formatInstallCount(1150)).toBe("1.2K");
    expect(formatInstallCount(1280)).toBe("1.3K");
  });
});
