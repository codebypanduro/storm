import { discoverPrimitives } from "./discovery.js";
import { runCommand } from "./runner.js";

export async function loadContexts(cwd: string): Promise<Map<string, string>> {
  const entries = await discoverPrimitives(cwd, "context");
  const contexts = new Map<string, string>();

  for (const entry of entries) {
    if (entry.frontmatter.command) {
      const result = await runCommand(entry.frontmatter.command, {
        timeout: entry.frontmatter.timeout,
        cwd,
      });
      contexts.set(entry.name, result.stdout.trim());
    } else {
      contexts.set(entry.name, entry.body);
    }
  }

  return contexts;
}
