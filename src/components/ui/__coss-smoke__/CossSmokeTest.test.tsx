// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CossSmokeTest } from "./CossSmokeTest";

afterEach(() => {
  cleanup();
});

describe("CossSmokeTest (Phase 1 coss token smoke)", () => {
  it("renders the supplied title", () => {
    render(<CossSmokeTest title="Hello coss" />);
    expect(screen.getByText("Hello coss")).toBeTruthy();
  });

  it("root surface uses bg-background, text-foreground, and border-border", () => {
    render(<CossSmokeTest />);
    const root = screen.getByTestId("coss-smoke-root");
    const className = root.className;

    expect(className).toContain("bg-background");
    expect(className).toContain("text-foreground");
    expect(className).toContain("border-border");
  });

  it("header opts into the coss --font-heading variable", () => {
    render(<CossSmokeTest />);
    const header = screen.getByTestId("coss-smoke-header");

    expect(header.className).toContain("font-heading");
  });

  it("card surface uses bg-card and text-card-foreground", () => {
    render(<CossSmokeTest />);
    const card = screen.getByTestId("coss-smoke-card");

    expect(card.className).toContain("bg-card");
    expect(card.className).toContain("text-card-foreground");
  });

  it("action buttons use primary, secondary, and destructive coss tokens", () => {
    render(<CossSmokeTest />);

    const primary = screen.getByTestId("coss-smoke-primary");
    expect(primary.className).toContain("bg-primary");
    expect(primary.className).toContain("text-primary-foreground");

    const secondary = screen.getByTestId("coss-smoke-secondary");
    expect(secondary.className).toContain("bg-secondary");
    expect(secondary.className).toContain("text-secondary-foreground");

    const destructive = screen.getByTestId("coss-smoke-destructive");
    expect(destructive.className).toContain("bg-destructive");
    expect(destructive.className).toContain("text-destructive-foreground");
  });
});
