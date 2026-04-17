// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRequest } from "../../../types";
import { ApprovalToasts } from "./ApprovalToasts";

describe("ApprovalToasts", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows batch approve action when approvals share the same thread without turn id", () => {
    const approvals: ApprovalRequest[] = [
      {
        workspace_id: "ws-1",
        request_id: "req-1",
        method: "item/fileChange/requestApproval",
        params: {
          threadId: "claude:thread-1",
          file_path: "aaa.txt",
        },
      },
      {
        workspace_id: "ws-1",
        request_id: "req-2",
        method: "item/fileChange/requestApproval",
        params: {
          threadId: "claude:thread-1",
          file_path: "bbb.txt",
        },
      },
    ];
    const onApproveBatch = vi.fn();

    render(
      <ApprovalToasts
        approvals={approvals}
        workspaces={[]}
        onDecision={vi.fn()}
        onApproveBatch={onApproveBatch}
        variant="inline"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "approval.approveTurnBatch" }));
    expect(onApproveBatch).toHaveBeenCalledWith(approvals);
  });

  it("falls back to workspace file batch in inline mode when thread ids are missing", () => {
    const approvals: ApprovalRequest[] = [
      {
        workspace_id: "ws-1",
        request_id: "req-1",
        method: "item/fileChange/requestApproval",
        params: {
          toolName: "Write",
          input: { file_path: "aaa.txt" },
        },
      },
      {
        workspace_id: "ws-1",
        request_id: "req-2",
        method: "item/fileChange/requestApproval",
        params: {
          toolName: "Write",
          input: { file_path: "bbb.txt" },
        },
      },
    ];
    const onApproveBatch = vi.fn();

    render(
      <ApprovalToasts
        approvals={approvals}
        workspaces={[]}
        onDecision={vi.fn()}
        onApproveBatch={onApproveBatch}
        variant="inline"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "approval.approveTurnBatch" }));
    expect(onApproveBatch).toHaveBeenCalledWith(approvals);
  });

  it("does not show batch approve action when the latest approval is not a file change", () => {
    render(
      <ApprovalToasts
        approvals={[
          {
            workspace_id: "ws-1",
            request_id: "req-1",
            method: "item/fileChange/requestApproval",
            params: {
              toolName: "Write",
              input: { file_path: "aaa.txt" },
            },
          },
          {
            workspace_id: "ws-1",
            request_id: "req-2",
            method: "item/commandExecution/requestApproval",
            params: {
              toolName: "ShellCommand",
              command: ["pwd"],
            },
          },
        ]}
        workspaces={[]}
        onDecision={vi.fn()}
        onApproveBatch={vi.fn()}
        variant="inline"
      />,
    );

    expect(screen.queryByRole("button", { name: "approval.approveTurnBatch" })).toBeNull();
  });

  it("hides large file content fields from approval detail view", () => {
    const { container } = render(
      <ApprovalToasts
        approvals={[
          {
            workspace_id: "ws-1",
            request_id: "req-1",
            method: "item/fileChange/requestApproval",
            params: {
              toolName: "Write",
              file_path: "/repo/.env.example",
              content: "SECRET=demo",
              new_string: "NEXT=demo",
              message: "Approve to continue",
            },
          },
        ]}
        workspaces={[]}
        onDecision={vi.fn()}
        variant="inline"
      />,
    );

    expect(screen.getByText("approval.filePathLabel")).toBeTruthy();
    expect(screen.getByText("/repo/.env.example")).toBeTruthy();
    expect(screen.getByText("approval.toolLabel")).toBeTruthy();
    expect(screen.getByText("Write")).toBeTruthy();
    expect(container.querySelector(".approval-toast-icon-wrap")).toBeTruthy();
    expect(container.querySelector(".approval-toast-summary-band")).toBeTruthy();
    expect(container.querySelector(".approval-toast-badge")).toBeTruthy();
    expect(screen.queryByText("Content")).toBeNull();
    expect(screen.queryByText("New string")).toBeNull();
    expect(screen.queryByText("SECRET=demo")).toBeNull();
    expect(screen.queryByText("NEXT=demo")).toBeNull();
  });

  it("reads file path and tool name from nested input payloads", () => {
    render(
      <ApprovalToasts
        approvals={[
          {
            workspace_id: "ws-1",
            request_id: "req-nested-1",
            method: "item/fileChange/requestApproval",
            params: {
              toolName: "Write",
              input: {
                file_path: "/repo/nested/demo.txt",
                tool_name: "NestedWrite",
              },
            },
          },
        ]}
        workspaces={[]}
        onDecision={vi.fn()}
        variant="inline"
      />,
    );

    expect(screen.getByText("/repo/nested/demo.txt")).toBeTruthy();
    expect(screen.getByText("Write")).toBeTruthy();
  });
});
