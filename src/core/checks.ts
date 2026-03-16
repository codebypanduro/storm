import { discoverPrimitives } from "../primitives/discovery.js";
import { runCommand } from "../primitives/runner.js";
import type { CheckResults } from "./types.js";
import { log } from "./output.js";

export async function runChecks(cwd: string): Promise<CheckResults> {
  const entries = await discoverPrimitives(cwd, "check");
  const results: CheckResults["results"] = [];

  for (const entry of entries) {
    if (!entry.frontmatter.command) {
      log.warn(`Check "${entry.name}" has no command, skipping`);
      continue;
    }

    const result = await runCommand(entry.frontmatter.command, {
      timeout: entry.frontmatter.timeout || 60_000,
      cwd,
    });

    const passed = result.exitCode === 0;
    const output = (result.stdout + "\n" + result.stderr).trim();

    if (passed) {
      log.success(`${entry.name}: ${entry.frontmatter.description || entry.frontmatter.command}`);
    } else {
      log.error(`${entry.name}: ${entry.frontmatter.description || entry.frontmatter.command}`);
    }

    results.push({
      name: entry.name,
      passed,
      output,
      command: entry.frontmatter.command,
    });
  }

  const allPassed = results.every((r) => r.passed);
  const failureSummary = results
    .filter((r) => !r.passed)
    .map((r) => `**${r.name}** (\`${r.command}\`):\n\`\`\`\n${r.output.slice(0, 2000)}\n\`\`\``)
    .join("\n\n");

  return { results, allPassed, failureSummary };
}
