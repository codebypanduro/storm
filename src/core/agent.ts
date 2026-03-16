import type { StormConfig, AgentResult, AgentUsage } from "./types.js";
import { STOP_MARKER } from "./constants.js";
import { log } from "./output.js";

export async function spawnAgent(
  prompt: string,
  config: StormConfig,
  options: { timeout?: number; cwd?: string } = {}
): Promise<AgentResult> {
  const { timeout = 300_000, cwd } = options;

  const args = [
    ...config.agent.args,
    "--verbose",
    "--output-format",
    "stream-json",
    "--model",
    config.agent.model,
  ];

  log.dim(`  $ ${config.agent.command} ${args.join(" ")}`);

  const start = Date.now();
  const proc = Bun.spawn([config.agent.command, ...args], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Write prompt to stdin
  proc.stdin.write(prompt);
  proc.stdin.end();

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeout);

  // Read stdout line by line, parse stream-json
  let output = "";
  let usage: AgentUsage | undefined;
  let exitCode = 0;
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === "result") {
              output = msg.result || "";
              if (msg.usage) {
                usage = {
                  inputTokens: msg.usage.input_tokens ?? 0,
                  outputTokens: msg.usage.output_tokens ?? 0,
                  cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
                  cacheCreationTokens: msg.usage.cache_creation_input_tokens ?? 0,
                };
              }
            } else if (msg.type === "assistant" && msg.message?.content) {
              for (const block of msg.message.content) {
                if (block.type === "tool_use") {
                  log.dim(`  [tool] ${block.name}`);
                }
              }
            }
          } catch {
            // Not JSON, skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Also capture stderr
    const stderr = await new Response(proc.stderr).text();
    if (stderr.trim()) {
      log.dim(`  [stderr] ${stderr.trim().slice(0, 200)}`);
    }

    exitCode = await proc.exited;
  } finally {
    clearTimeout(timer);
  }

  const done = output.includes(STOP_MARKER);
  const durationMs = Date.now() - start;

  return { output, exitCode, done, timedOut, usage, durationMs };
}
