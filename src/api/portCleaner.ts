import { invoke } from "@tauri-apps/api/core";

import type {
  PortBinding,
  ProcessDetails,
  TerminateRequest,
  TerminationResult,
} from "../types/portCleaner";

export function listPortBindings(): Promise<PortBinding[]> {
  return invoke<PortBinding[]>("list_port_bindings");
}

export function getProcessDetails(pid: number): Promise<ProcessDetails> {
  return invoke<ProcessDetails>("get_process_details", { pid });
}

export function terminateProcess(
  request: TerminateRequest,
): Promise<TerminationResult> {
  return invoke<TerminationResult>("terminate_process", { request });
}
