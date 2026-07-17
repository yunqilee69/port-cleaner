import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  getProcessDetails,
  listPortBindings,
  terminateProcess,
} from "./portCleaner";
import type {
  PortBinding,
  ProcessDetails,
  TerminateRequest,
  TerminationResult,
} from "../types/portCleaner";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("port cleaner API", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("lists port bindings with the exact Tauri command", async () => {
    const bindings: PortBinding[] = [
      {
        id: "tcp:127.0.0.1:3000:42",
        protocol: "tcp",
        localAddress: "127.0.0.1",
        port: 3000,
        state: "listening",
        pid: 42,
        processName: "node",
        userName: null,
        access: "allowed",
      },
    ];
    invokeMock.mockResolvedValue(bindings);

    const result = await listPortBindings();

    expectTypeOf(result).toEqualTypeOf<PortBinding[]>();
    expect(result).toEqual(bindings);
    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("list_port_bindings");
  });

  it("gets process details with the exact pid payload", async () => {
    const details: ProcessDetails = {
      pid: 42,
      name: "node",
      executablePath: null,
      userName: "developer",
      commandLine: null,
      access: "restricted",
    };
    invokeMock.mockResolvedValue(details);

    const result = await getProcessDetails(42);

    expectTypeOf(result).toEqualTypeOf<ProcessDetails>();
    expect(result).toEqual(details);
    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("get_process_details", { pid: 42 });
  });

  it("terminates a process with the request nested exactly once", async () => {
    const request: TerminateRequest = {
      pid: 42,
      protocol: "udp",
      localAddress: "0.0.0.0",
      port: 5353,
    };
    const termination: TerminationResult = {
      pid: 42,
      terminated: true,
    };
    invokeMock.mockResolvedValue(termination);

    const result = await terminateProcess(request);

    expectTypeOf(result).toEqualTypeOf<TerminationResult>();
    expect(result).toEqual(termination);
    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("terminate_process", { request });
  });
});
