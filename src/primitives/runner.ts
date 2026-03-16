import type { CommandResult } from "../core/types.js";

export async function runCommand(
  command: string,
  options: { timeout?: number; cwd?: string } = {}
): Promise<CommandResult> {
  const { timeout = 60_000, cwd } = options;

  const proc = Bun.spawn(["sh", "-c", command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeout);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  clearTimeout(timer);

  return { stdout, stderr, exitCode, timedOut };
}
