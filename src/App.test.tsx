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
    state: "unknown",
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

  it("filters bindings by search, protocol, and access", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("node")).toBeInTheDocument();
    expect(screen.getByText("5353")).toBeInTheDocument();

    await user.type(
      screen.getByRole("searchbox", { name: /search bindings/i }),
      "3000",
    );
    expect(screen.getByText("3000")).toBeInTheDocument();
    expect(screen.queryByText("5353")).not.toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: /search bindings/i }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: /protocol/i }),
      "udp",
    );
    expect(screen.getByText("5353")).toBeInTheDocument();
    expect(screen.queryByText("3000")).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /^access$/i }),
      "restricted",
    );
    const restrictedRow = screen.getByRole("row", {
      name: /udp 0\.0\.0\.0 5353/i,
    });
    expect(within(restrictedRow).getByText(/restricted/i)).toBeInTheDocument();
  });

  it("combines independent access and binding-state filters, including unknown", async () => {
    const user = userEvent.setup();
    listPortBindingsMock.mockResolvedValue([
      ...bindings,
      {
        ...bindings[0],
        id: "tcp:127.0.0.1:3001:4243",
        port: 3001,
        state: "connected",
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
      screen.getByRole("combobox", { name: /^access$/i }),
      "allowed",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: /binding state/i }),
      "listening",
    );

    expect(screen.getByText("node")).toBeInTheDocument();
    expect(screen.queryByText("worker")).not.toBeInTheDocument();
    expect(screen.queryByText("restricted-listener")).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /^access$/i }),
      "all",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: /binding state/i }),
      "unknown",
    );

    expect(screen.getByText("5353")).toBeInTheDocument();
    expect(screen.queryByText("3000")).not.toBeInTheDocument();
  });

  it("disables termination when ownership is restricted", async () => {
    render(<App />);

    const restrictedRow = await screen.findByRole("row", {
      name: /udp 0\.0\.0\.0 5353/i,
    });
    expect(
      within(restrictedRow).getByRole("button", {
        name: /terminate unavailable/i,
      }),
    ).toBeDisabled();
  });

  it("loads details only when the selected binding has a valid PID", async () => {
    const user = userEvent.setup();
    render(<App />);

    const restrictedDetailsButton = await screen.findByRole("button", {
      name: /view process details for unknown process.*5353/i,
    });
    await user.click(restrictedDetailsButton);
    expect(getProcessDetailsMock).not.toHaveBeenCalled();
    expect(screen.getByRole("complementary", { name: /unknown process/i })).toHaveTextContent(
      /no valid pid/i,
    );

    await user.click(screen.getByRole("button", { name: /close process details/i }));
    expect(restrictedDetailsButton).toHaveFocus();

    const detailsButton = screen.getByRole("button", {
      name: /view process details for node.*3000/i,
    });
    await user.click(detailsButton);
    expect(await screen.findByText("/opt/homebrew/bin/node")).toBeInTheDocument();
    expect(getProcessDetailsMock).toHaveBeenCalledWith(4242);
    expect(screen.getByRole("button", { name: /close process details/i })).toHaveFocus();
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
      name: /view process details for node.*3000/i,
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
      await screen.findByRole("button", { name: /terminate node pid 4242/i }),
    );

    const dialog = screen.getByRole("dialog", { name: /confirm termination/i });
    expect(dialog).toHaveTextContent("node");
    expect(dialog).toHaveTextContent("4242");
    expect(dialog).toHaveTextContent("TCP");
    expect(dialog).toHaveTextContent("127.0.0.1:3000");
    expect(dialog).toHaveTextContent(/unsaved work/i);

    await user.click(
      within(dialog).getByRole("button", { name: /terminate process/i }),
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
    expect(screen.getByRole("button", { name: /refresh now/i })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(
      /node.*4242.*terminated/i,
    );
    const successStatus = screen.getByRole("region", { name: /operation status/i });
    expect(successStatus).toHaveTextContent(/node.*4242.*terminated gracefully/i);
    await user.click(within(successStatus).getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("region", { name: /operation status/i })).not.toBeInTheDocument();
  });

  it("traps focus while termination submits and restores it only after close", async () => {
    const user = userEvent.setup();
    const termination = deferred<{ pid: number; terminated: boolean }>();
    terminateProcessMock.mockReturnValue(termination.promise);
    render(<App />);

    const trigger = await screen.findByRole("button", {
      name: /terminate node pid 4242/i,
    });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: /confirm termination/i });
    const cancelButton = within(dialog).getByRole("button", { name: /cancel/i });
    const confirmButton = within(dialog).getByRole("button", {
      name: /terminate process/i,
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
      name: /terminate node pid 4242/i,
    });
    terminateButton.focus();
    await user.keyboard(input);

    expect(screen.getByRole("dialog", { name: /confirm termination/i })).toBeInTheDocument();
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
      name: /view process details for node.*3000/i,
    });
    await user.click(detailsButton);
    expect(screen.getByRole("complementary", { name: /node/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /refresh now/i }));

    await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
    expect(screen.queryByText("node")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh now/i })).toHaveFocus();
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
        name: /view process details for node.*3000/i,
      }),
    );
    expect(screen.getByRole("complementary", { name: /node/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /refresh now/i }));

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
      await screen.findByRole("button", { name: /terminate node pid 4242/i }),
    );
    expect(screen.getByRole("dialog", { name: /confirm termination/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /refresh now/i }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /confirm termination/i })).not.toBeInTheDocument());
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
      name: /view process details for node.*3000/i,
    });
    await user.click(detailsButton);
    const drawer = screen.getByRole("complementary", { name: /node/i });
    await user.click(within(drawer).getByRole("button", { name: /terminate process/i }));

    const dialog = screen.getByRole("dialog", { name: /confirm termination/i });
    await user.click(within(dialog).getByRole("button", { name: /terminate process/i }));

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(detailsButton).toHaveFocus();
  });

  it("shows visible refresh progress until the latest request settles", async () => {
    const request = deferred<PortBinding[]>();
    listPortBindingsMock.mockReturnValue(request.promise);
    render(<App />);

    expect(screen.getByText(/refreshing bindings/i)).toBeVisible();

    await act(async () => {
      request.resolve(bindings);
      await request.promise;
    });

    expect(screen.queryByText(/refreshing bindings/i)).not.toBeInTheDocument();
  });

  it("shows a useful error state when bindings cannot be loaded", async () => {
    listPortBindingsMock.mockRejectedValue(
      new Error("command failed: lsof unavailable"),
    );
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not scan local ports/i,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/lsof unavailable/i);
    expect(
      screen.getByRole("button", { name: /retry scan/i }),
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

  it("commits only the newest refresh when requests resolve out of order", async () => {
    vi.useFakeTimers();
    try {
      const oldestRequest = deferred<PortBinding[]>();
      const newestRequest = deferred<PortBinding[]>();
      const newestBinding: PortBinding = {
        ...bindings[0],
        id: "tcp:127.0.0.1:4000:5252",
        port: 4000,
        pid: 5252,
        processName: "newest-service",
      };
      listPortBindingsMock
        .mockReturnValueOnce(oldestRequest.promise)
        .mockReturnValueOnce(newestRequest.promise);
      render(<App />);

      expect(listPortBindingsMock).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(listPortBindingsMock).toHaveBeenCalledTimes(2);

      await act(async () => {
        newestRequest.resolve([newestBinding]);
        await newestRequest.promise;
      });
      expect(screen.getByText("newest-service")).toBeInTheDocument();
      const newestRefreshText = screen.getByText(/last refreshed:/i).textContent;
      expect(screen.getByRole("button", { name: /refresh now/i })).toBeEnabled();

      await act(async () => {
        oldestRequest.resolve(bindings);
        await oldestRequest.promise;
      });
      expect(screen.getByText("newest-service")).toBeInTheDocument();
      expect(screen.queryByText("node")).not.toBeInTheDocument();
      expect(screen.getByText(/last refreshed:/i)).toHaveTextContent(
        newestRefreshText ?? "",
      );
      expect(screen.getByRole("button", { name: /refresh now/i })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores an older refresh error after a newer success", async () => {
    vi.useFakeTimers();
    try {
      const oldestRequest = deferred<PortBinding[]>();
      const newestRequest = deferred<PortBinding[]>();
      listPortBindingsMock
        .mockReturnValueOnce(oldestRequest.promise)
        .mockReturnValueOnce(newestRequest.promise);
      render(<App />);

      expect(listPortBindingsMock).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });

      await act(async () => {
        newestRequest.resolve(bindings);
        await newestRequest.promise;
      });
      await act(async () => {
        oldestRequest.reject(new Error("old scan failed"));
        await oldestRequest.promise.catch(() => undefined);
      });

      expect(screen.getByText("node")).toBeInTheDocument();
      expect(screen.queryByText(/old scan failed/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/showing stale data/i)).not.toBeInTheDocument();
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
    ["port binding changed before termination", /binding changed.*no signal was sent/i],
    ["access is restricted", /permission denied.*restricted/i],
    ["process 4242 was not found", /process not found.*already exited/i],
    ["unexpected backend response", /termination failed.*unexpected backend response/i],
  ])("explains termination error: %s", async (backendError, expectedMessage) => {
    const user = userEvent.setup();
    terminateProcessMock.mockRejectedValue(new Error(backendError));
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: /terminate node pid 4242/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /terminate process/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(expectedMessage);
    expect(screen.getByRole("dialog", { name: /confirm termination/i })).toBeInTheDocument();
  });
});
