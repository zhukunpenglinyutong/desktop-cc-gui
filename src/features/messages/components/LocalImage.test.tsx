// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalImage } from "./LocalImage";

const readLocalImageDataUrlMock = vi.fn();

vi.mock("../../../services/tauri", () => ({
  readLocalImageDataUrl: (workspaceId: string, path: string) =>
    readLocalImageDataUrlMock(workspaceId, path),
}));

describe("LocalImage", () => {
  beforeEach(() => {
    readLocalImageDataUrlMock.mockReset();
  });

  it("falls back to data-url when initial image load fails", async () => {
    readLocalImageDataUrlMock.mockResolvedValueOnce("data:image/png;base64,AAAA");

    render(
      <LocalImage
        src="asset://localhost/Users/test/images/example.png"
        workspaceId="ws-demo"
        localPath="/Users/test/images/example.png"
        alt="demo"
      />,
    );

    const image = screen.getByAltText("demo") as HTMLImageElement;
    fireEvent.error(image);

    await waitFor(() => {
      expect(readLocalImageDataUrlMock).toHaveBeenCalledWith(
        "ws-demo",
        "/Users/test/images/example.png",
      );
      expect(image.src).toContain("data:image/png;base64,AAAA");
    });
  });

  it("does not request backend fallback when workspaceId is missing", async () => {
    render(
      <LocalImage
        src="asset://localhost/Users/test/images/example.png"
        localPath="/Users/test/images/example.png"
        alt="demo-no-workspace"
      />,
    );

    const image = screen.getByAltText("demo-no-workspace") as HTMLImageElement;
    fireEvent.error(image);

    await waitFor(() => {
      expect(readLocalImageDataUrlMock).toHaveBeenCalledTimes(0);
    });
  });

  it("normalizes windows file urls before requesting backend fallback", async () => {
    readLocalImageDataUrlMock.mockResolvedValueOnce("data:image/png;base64,BBBB");

    render(
      <LocalImage
        src="file:///C:/Users/test/images/example.png"
        workspaceId="ws-windows"
        alt="demo-windows"
      />,
    );

    const image = screen.getByAltText("demo-windows") as HTMLImageElement;
    fireEvent.error(image);

    await waitFor(() => {
      expect(readLocalImageDataUrlMock).toHaveBeenCalledWith(
        "ws-windows",
        "C:/Users/test/images/example.png",
      );
      expect(image.src).toContain("data:image/png;base64,BBBB");
    });
  });
});
