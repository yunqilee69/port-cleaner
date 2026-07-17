export type Protocol = "tcp" | "udp";

export type BindingState = "listening" | "connected" | "unknown";

export type Access = "allowed" | "restricted";

export interface PortBinding {
  id: string;
  protocol: Protocol;
  localAddress: string;
  port: number;
  state: BindingState;
  pid: number | null;
  processName: string | null;
  userName: string | null;
  access: Access;
}

export interface ProcessDetails {
  pid: number;
  name: string;
  executablePath: string | null;
  userName: string | null;
  commandLine: string | null;
  access: Access;
}

export interface TerminateRequest {
  pid: number;
  protocol: Protocol;
  localAddress: string;
  port: number;
}

export interface TerminationResult {
  pid: number;
  terminated: boolean;
}
