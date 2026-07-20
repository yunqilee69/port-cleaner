import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import {
  getProcessDetails,
  listPortBindings,
  terminateProcess,
} from "./api/portCleaner";
import type { PortBinding, ProcessDetails } from "./types/portCleaner";

vi.mock("./api/portCleaner", () => ({
  getProcessDetails: vi.fn(),
  listPortBindings: vi.fn(),
  terminateProcess: vi.fn(),
}));

const listPortBindingsMock = vi.mocked(listPortBindings);
const getProcessDetailsMock = vi.mocked(getProcessDetails);
const terminateProcessMock = vi.mocked(terminateProcess);

const bindings: PortBinding[] = [
  {
    id: "tcp:127.0.0.1:3000:4242",
    protocol: "tcp",
    localAddress: "127.0.0.1",
    port: 3000,
    state: "listening",
    pid: 4242,
    processName: "node",
    userName: "operator",
    access: "allowed",
  },
  {
    id: "udp:0.0.0.0:5353:none",
    protocol: "udp",
    localAddress: "0.0.0.0",
    port: 5353,
    state: "listening",
    pid: null,
    processName: null,
    userName: null,
    access: "restricted",
  },
];

const details: ProcessDetails = {
  pid: 4242,
  name: "node",
  executablePath: "/opt/homebrew/bin/node",
  userName: "operator",
  commandLine: "node /workspace/services/api/index.js --port 3000",
  access: "allowed",
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

describe("Port Cleaner console", () => {
  beforeEach(() => {
    listPortBindingsMock.mockReset();
    getProcessDetailsMock.mockReset();
    terminateProcessMock.mockReset();
    listPortBindingsMock.mockResolvedValue(bindings);
    getProcessDetailsMock.mockResolvedValue(details);
  });

  it("shows only the Port Cleaner brand in the header", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Port Cleaner" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("本机端口管理工具")).not.toBeInTheDocument();
    expect(screen.queryByText(/在线.*本机/)).not.toBeInTheDocument();
  });

  it("filters bindings by search, protocol, and access", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("node")).toBeInTheDocument();
    expect(screen.getByText("5353")).toBeInTheDocument();

    await user.type(
      screen.getByRole("searchbox", { name: /搜索监听端口/i }),
      "3000",
    );
    expect(screen.getByText("3000")).toBeInTheDocument();
    expect(screen.queryByText("5353")).not.toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: /搜索监听端口/i }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: /协议/i }),
      "udp",
    );
    expect(screen.getByText("5353")).toBeInTheDocument();
    expect(screen.queryByText("3000")).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /^权限$/i}),
      "restricted",
    );
    const restrictedRow = screen.getByRole("row", {
      name: /udp 0\.0\.0\.0 5353/i,
    });
    expect(within(restrictedRow).getByText(/受限/i)).toBeInTheDocument();
    expect(screen.queryByText("⌘ K")).not.toBeInTheDocument();
  });

  it("uses consistent custom chrome for filter selects", () => {
    render(<App />);

    for (const name of ["协议", "权限"]) {
      const select = screen.getByRole("combobox", { name });
      const field = select.closest("label");
      expect(field).toHaveClass("select-field--select");
      expect(field?.querySelector(".select-chevron")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    }
  });

  it("只显示监听端口，并使用中文界面文案", async () => {
    listPortBindingsMock.mockResolvedValue([
      ...bindings,
      {
        ...bindings[0],
        id: "tcp:127.0.0.1:3001:4243",
        port: 3001,
        state: "connected",
        pid: 4243,
        processName: "已连接进程",
      },
    ]);

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "监听端口" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("已连接进程")).not.toBeInTheDocument();
    expect(screen.getAllByText("监听中").length).toBeGreaterThan(0);
    expect(screen.queryByRole("combobox", { name: "状态" })).not.toBeInTheDocument();
    expect(screen.queryByText("Network bindings")).not.toBeInTheDocument();
  });

  it("moves aggregate statistics into the binding table header", async () => {
    render(<App />);

    await screen.findByText("node");

    expect(
      screen.queryByRole("heading", { name: "监听端口概览" }),
    ).not.toBeInTheDocument();
    const statistics = screen.getByRole("region", { name: "端口统计" });
    expect(statistics).toHaveTextContent("显示 2 / 共 2 个");
    expect(statistics).toHaveTextContent("TCP 1");
    expect(statistics).toHaveTextContent("UDP 1");
    expect(statistics).toHaveTextContent("受限 1");
    expect(statistics).toHaveTextContent(/最近刷新：/);
  });

  it("按配置的端口范围显示可结束的监听端口", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.clear(screen.getByRole("spinbutton", { name: "起始端口" }));
    await user.type(screen.getByRole("spinbutton", { name: "起始端口" }), "5000");
    await user.clear(screen.getByRole("spinbutton", { name: "结束端口" }));
    await user.type(screen.getByRole("spinbutton", { name: "结束端口" }), "10000");

    expect(screen.getByText("5353")).toBeInTheDocument();
    expect(screen.queryByText("3000")).not.toBeInTheDocument();
  });

  it("preserves full unbounded table values for accessible inspection", async () => {
    const longBinding: PortBinding = {
      ...bindings[0],
      id: "tcp:very-long-address:3000:4242",
      localAddress: "fe80::1234:5678:90ab:cdef%enormously-long-interface-name",
      processName: "a-process-name-that-is-long-enough-to-require-truncation",
      userName: "domain\\an-extremely-long-user-name-for-layout-testing",
    };
    listPortBindingsMock.mockResolvedValue([longBinding]);
    render(<App />);

    expect(await screen.findByText(longBinding.localAddress)).toHaveAttribute(
      "title",
      longBinding.localAddress,
    );
    expect(screen.getByText(longBinding.processName ?? "")).toHaveAttribute(
      "title",
      longBinding.processName,
    );
    expect(screen.getByText(longBinding.userName ?? "")).toHaveAttribute(
      "title",
      longBinding.userName,
    );
  });

  it("按访问权限和协议组合筛选监听端口", async () => {
    const user = userEvent.setup();
    listPortBindingsMock.mockResolvedValue([
      ...bindings,
      {
        ...bindings[0],
        id: "tcp:127.0.0.1:3001:4243",
        port: 3001,
        state: "listening",
        pid: 4243,
        processName: "worker",
      },
      {
        ...bindings[0],
        id: "tcp:127.0.0.1:3002:none",
        port: 3002,
        pid: null,
        processName: "restricted-listener",
        access: "restricted",
      },
    ]);
    render(<App />);

    expect(await screen.findByText("worker")).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /^权限$/i}),
      "allowed",
    );
    expect(screen.getByText("node")).toBeInTheDocument();
    expect(screen.getByText("worker")).toBeInTheDocument();
    expect(screen.queryByText("restricted-listener")).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /^权限$/i}),
      "all",
    );
    expect(screen.getByText("5353")).toBeInTheDocument();
    expect(screen.getByText("3000")).toBeInTheDocument();
  });

  it("disables termination when ownership is restricted", async () => {
    render(<App />);

    const restrictedRow = await screen.findByRole("row", {
      name: /udp 0\.0\.0\.0 5353/i,
    });
    expect(
      within(restrictedRow).getByRole("button", {
        name: /无法结束进程/i,
      }),
    ).toBeDisabled();
  });

  it("loads details only when the selected binding has a valid PID", async () => {
    const user = userEvent.setup();
    render(<App />);

    const restrictedDetailsButton = await screen.findByRole("button", {
      name: /查看 未知进程 的进程详情，端口 5353/i,
    });
    await user.click(restrictedDetailsButton);
    expect(getProcessDetailsMock).not.toHaveBeenCalled();
    expect(screen.getByRole("complementary", { name: /未知进程/i })).toHaveTextContent(
      /没有有效的 PID/i,
    );

    await user.click(screen.getByRole("button", { name: /关闭进程详情/i }));
    expect(restrictedDetailsButton).toHaveFocus();

    const detailsButton = screen.getByRole("button", {
      name: /查看 node 的进程详情，端口 3000/i,
    });
    await user.click(detailsButton);
    expect(await screen.findByText("/opt/homebrew/bin/node")).toBeInTheDocument();
    expect(getProcessDetailsMock).toHaveBeenCalledWith(4242);
    expect(screen.getByRole("button", { name: /关闭进程详情/i })).toHaveFocus();
  });

  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])("opens process details from the explicit button with %s", async (_key, input) => {
    const user = userEvent.setup();
    render(<App />);

    const row = await screen.findByRole("row", {
      name: /tcp 127\.0\.0\.1 3000/i,
    });
    expect(row).not.toHaveAttribute("tabindex");

    const detailsButton = within(row).getByRole("button", {
      name: /查看 node 的进程详情，端口 3000/i,
    });
    detailsButton.focus();
    await user.keyboard(input);

    expect(screen.getByRole("complementary", { name: /node/i })).toBeInTheDocument();
  });

  it("does not open details when the non-interactive row is clicked", async () => {
    const user = userEvent.setup();
    render(<App />);

    const row = await screen.findByRole("row", {
      name: /tcp 127\.0\.0\.1 3000/i,
    });
    await user.click(row);

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(getProcessDetailsMock).not.toHaveBeenCalled();
  });

  it("submits the full graceful termination request and refreshes", async () => {
    const user = userEvent.setup();
    terminateProcessMock.mockResolvedValue({ pid: 4242, terminated: true });
    listPortBindingsMock
      .mockResolvedValueOnce(bindings)
      .mockResolvedValueOnce(bindings.slice(1));
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: /结束 node，PID 4242/i }),
    );

    const dialog = screen.getByRole("dialog", { name: /确认结束进程/i });
    expect(dialog).toHaveTextContent("node");
    expect(dialog).toHaveTextContent("4242");
    expect(dialog).toHaveTextContent("TCP");
    expect(dialog).toHaveTextContent("127.0.0.1:3000");
    expect(dialog).toHaveTextContent(/未保存的数据/i);

    await user.click(
      within(dialog).getByRole("button", { name: /确认结束进程/i }),
    );

    await waitFor(() => {
      expect(terminateProcessMock).toHaveBeenCalledWith({
        pid: 4242,
        protocol: "tcp",
        localAddress: "127.0.0.1",
        port: 3000,
      });
    });
    await waitFor(() => expect(listPortBindingsMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /立即刷新/i })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(
      /已向 node（PID 4242）发送正常结束信号/i,
    );
    const successStatus = screen.getByRole("region", { name: /操作状态/i });
    expect(successStatus).toHaveTextContent(/已向 node（PID 4242）发送正常结束信号/i);
    await user.click(within(successStatus).getByRole("button", { name: /关闭/i }));
    expect(screen.queryByRole("region", { name: /操作状态/i })).not.toBeInTheDocument();
  });

  it("shows the forceful Windows command before termination", async () => {
    const userAgent = vi
      .spyOn(window.navigator, "userAgent", "get")
      .mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    const user = userEvent.setup();

    try {
      render(<App />);
      await user.click(
        await screen.findByRole("button", { name: /结束 node，PID 4242/i }),
      );

      const dialog = screen.getByRole("dialog", { name: /确认结束进程/i });
      expect(dialog).toHaveTextContent("taskkill.exe /PID 4242 /T /F");
      expect(dialog).toHaveTextContent(/强制结束目标进程及其子进程/i);
    } finally {
      userAgent.mockRestore();
    }
  });

  it("runs a fresh post-termination scan after a pending earlier scan settles", async () => {
    const user = userEvent.setup();
    const preTerminationScan = deferred<PortBinding[]>();
    const postTerminationScan = deferred<PortBinding[]>();
    terminateProcessMock.mockResolvedValue({ pid: 4242, terminated: true });
    listPortBindingsMock
      .mockResolvedValueOnce(bindings)
      .mockReturnValueOnce(preTerminationScan.promise)
      .mockReturnValueOnce(postTerminationScan.promise);
    render(<App />);

    await screen.findByText("node");
    await user.click(screen.getByRole("button", { name: /立即刷新/i }));
    expect(listPortBindingsMock).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: /结束 node，PID 4242/i }));
    await user.click(
      screen.getByRole("button", { name: /确认结束进程/i }),
    );
    await waitFor(() => expect(terminateProcessMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      preTerminationScan.resolve(bindings);
      await preTerminationScan.promise;
    });

    await waitFor(() => expect(listPortBindingsMock).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("row", { name: /tcp 127\.0\.0\.1 3000/i })).toBeInTheDocument();

    await act(async () => {
      postTerminationScan.resolve([]);
      await postTerminationScan.promise;
    });

    await waitFor(() => expect(
      screen.queryByRole("row", { name: /tcp 127\.0\.0\.1 3000/i }),
    ).not.toBeInTheDocument());
    expect(screen.getByRole("region", { name: /操作状态/i })).toHaveTextContent(
      /已向 node（PID 4242）发送正常结束信号/i,
    );
  });

  it("traps focus while termination submits and restores it only after close", async () => {
    const user = userEvent.setup();
    const termination = deferred<{ pid: number; terminated: boolean }>();
    terminateProcessMock.mockReturnValue(termination.promise);
    render(<App />);

    const trigger = await screen.findByRole("button", {
      name: /结束 node，PID 4242/i,
    });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: /确认结束进程/i });
    const cancelButton = within(dialog).getByRole("button", { name: /取消/i });
    const confirmButton = within(dialog).getByRole("button", {
      name: /确认结束进程/i,
    });
    expect(cancelButton).toHaveFocus();

    await user.tab({ shift: true });
    expect(confirmButton).toHaveFocus();
    await user.tab();
    expect(cancelButton).toHaveFocus();

    await user.click(confirmButton);
    await waitFor(() => expect(confirmButton).toBeDisabled());
    expect(dialog).toHaveFocus();

    trigger.focus();
    await user.tab();
    expect(dialog).toHaveFocus();

    termination.resolve({ pid: 4242, terminated: true });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])("does not select a row when termination is activated with %s", async (_key, input) => {
    const user = userEvent.setup();
    render(<App />);

    const terminateButton = await screen.findByRole("button", {
      name: /结束 node，PID 4242/i,
    });
    terminateButton.focus();
    await user.keyboard(input);

    expect(screen.getByRole("dialog", { name: /确认结束进程/i })).toBeInTheDocument();
    expect(getProcessDetailsMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("closes process details when a refresh removes the selected binding", async () => {
    const user = userEvent.setup();
    listPortBindingsMock
      .mockResolvedValueOnce(bindings)
      .mockResolvedValueOnce(bindings.slice(1));
    render(<App />);

    const detailsButton = await screen.findByRole("button", {
      name: /查看 node 的进程详情，端口 3000/i,
    });
    await user.click(detailsButton);
    expect(screen.getByRole("complementary", { name: /node/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /立即刷新/i }));

    await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
    expect(screen.queryByText("node")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /立即刷新/i })).toHaveFocus();
  });

  it("closes process details when the selected binding identity changes", async () => {
    const user = userEvent.setup();
    const replacement: PortBinding = {
      ...bindings[0],
      pid: 9999,
      processName: "replacement-service",
    };
    listPortBindingsMock
      .mockResolvedValueOnce(bindings)
      .mockResolvedValueOnce([replacement, bindings[1]]);
    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: /查看 node 的进程详情，端口 3000/i,
      }),
    );
    expect(screen.getByRole("complementary", { name: /node/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /立即刷新/i }));

    await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
    expect(screen.getByText("replacement-service")).toBeInTheDocument();
  });

  it("closes termination when the binding identity changes before confirmation", async () => {
    const user = userEvent.setup();
    const replacement: PortBinding = {
      ...bindings[0],
      pid: 9999,
      processName: "replacement-service",
    };
    listPortBindingsMock
      .mockResolvedValueOnce(bindings)
      .mockResolvedValueOnce([replacement, bindings[1]]);
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: /结束 node，PID 4242/i }),
    );
    expect(screen.getByRole("dialog", { name: /确认结束进程/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /立即刷新/i }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /确认结束进程/i })).not.toBeInTheDocument());
    expect(screen.getByText("replacement-service")).toBeInTheDocument();
    expect(terminateProcessMock).not.toHaveBeenCalled();
  });

  it("restores drawer-originated termination focus to the durable details trigger", async () => {
    const user = userEvent.setup();
    terminateProcessMock.mockResolvedValue({ pid: 4242, terminated: true });
    listPortBindingsMock
      .mockResolvedValueOnce(bindings)
      .mockResolvedValueOnce(bindings);
    render(<App />);

    const detailsButton = await screen.findByRole("button", {
      name: /查看 node 的进程详情，端口 3000/i,
    });
    await user.click(detailsButton);
    const drawer = screen.getByRole("complementary", { name: /node/i });
    await user.click(within(drawer).getByRole("button", { name: /结束进程/i }));

    const dialog = screen.getByRole("dialog", { name: /确认结束进程/i });
    await user.click(within(dialog).getByRole("button", { name: /确认结束进程/i }));

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(detailsButton).toHaveFocus();
  });

  it("shows refresh progress only on the header button", async () => {
    const request = deferred<PortBinding[]>();
    listPortBindingsMock.mockReturnValue(request.promise);
    render(<App />);

    const refreshButton = screen.getByRole("button", { name: /扫描中/i });
    expect(refreshButton).toBeDisabled();
    expect(screen.queryByText(/正在刷新监听端口/i)).not.toBeInTheDocument();

    await act(async () => {
      request.resolve(bindings);
      await request.promise;
    });

    expect(
      screen.getByRole("button", { name: /立即刷新/i }),
    ).toBeEnabled();
  });

  it("shows a useful error state when bindings cannot be loaded", async () => {
    listPortBindingsMock.mockRejectedValue(
      new Error("command failed: lsof unavailable"),
    );
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /无法扫描本机监听端口/i,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/lsof unavailable/i);
    expect(
      screen.getByRole("button", { name: /重试扫描/i }),
    ).toBeInTheDocument();
  });

  it("auto-refreshes every five seconds and cleans up its interval", async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<App />);
      await vi.waitFor(() => expect(listPortBindingsMock).toHaveBeenCalledTimes(1));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(listPortBindingsMock).toHaveBeenCalledTimes(2);

      unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(listPortBindingsMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips auto-refresh ticks while a scan is pending and resumes after settle", async () => {
    vi.useFakeTimers();
    try {
      const initialRequest = deferred<PortBinding[]>();
      listPortBindingsMock
        .mockReturnValueOnce(initialRequest.promise)
        .mockResolvedValueOnce(bindings);
      render(<App />);

      expect(listPortBindingsMock).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(listPortBindingsMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        initialRequest.resolve(bindings);
        await initialRequest.promise;
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(listPortBindingsMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not commit an in-flight refresh after unmount", async () => {
    const request = deferred<PortBinding[]>();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    listPortBindingsMock.mockReturnValue(request.promise);
    const { unmount } = render(<App />);

    expect(listPortBindingsMock).toHaveBeenCalledTimes(1);
    unmount();
    request.resolve(bindings);
    await act(async () => {
      await request.promise;
    });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it.each([
    ["port binding changed before termination", /端口占用已变化.*未发送结束信号/i],
    ["access is restricted", /权限不足.*进程受限/i],
    ["process 4242 was not found", /未找到进程.*可能已退出/i],
    ["unexpected backend response", /结束进程失败.*unexpected backend response/i],
  ])("explains termination error: %s", async (backendError, expectedMessage) => {
    const user = userEvent.setup();
    terminateProcessMock.mockRejectedValue(new Error(backendError));
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: /结束 node，PID 4242/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /确认结束进程/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(expectedMessage);
    expect(screen.getByRole("dialog", { name: /确认结束进程/i })).toBeInTheDocument();
  });
});
