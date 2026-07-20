export interface TerminationPresentation {
  command: string;
  forceful: boolean;
}

export function terminationPresentation(
  pid: number,
  userAgent = navigator.userAgent,
): TerminationPresentation {
  if (/Windows/i.test(userAgent)) {
    return {
      command: `taskkill.exe /PID ${pid} /T /F`,
      forceful: true,
    };
  }

  return {
    command: `/bin/kill -TERM ${pid}`,
    forceful: false,
  };
}
