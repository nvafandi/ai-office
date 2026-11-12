import { spawn } from "node:child_process";

export type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

/** Run one command in a child process and kill it when it exceeds `timeoutMs`. */
export function runCommand(
  command: string,
  args: string[],
  opts: { timeoutMs?: number } = {}
): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: RunResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: -1, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.on("error", (err) =>
      finish({ code: -1, stdout, stderr: String(err), timedOut: false })
    );
    child.on("close", (code) =>
      finish({ code: code ?? -1, stdout, stderr, timedOut: false })
    );
  });
}
