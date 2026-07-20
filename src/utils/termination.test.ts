import { describe, expect, it } from "vitest";

import { terminationPresentation } from "./termination";

describe("terminationPresentation", () => {
  it("shows the forceful taskkill command on Windows", () => {
    expect(
      terminationPresentation(4242, "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"),
    ).toEqual({
      command: "taskkill.exe /PID 4242 /T /F",
      forceful: true,
    });
  });

  it("shows the graceful kill command on Unix platforms", () => {
    expect(terminationPresentation(4242, "Mozilla/5.0 (Macintosh)")).toEqual({
      command: "/bin/kill -TERM 4242",
      forceful: false,
    });
  });
});
