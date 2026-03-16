import { join } from "path";
import { existsSync } from "fs";
import { readdir } from "fs/promises";
import matter from "gray-matter";
import { CONFIG_DIR, AGENTS_DIR, AGENT_FILE, DEFAULT_KIBBLE } from "../core/constants.js";
import type { AgentConfig } from "../core/types.js";

export const DEFAULT_AGENTS: AgentConfig[] = [
  {
    id: "storm",
    name: "Storm",
    role: "Architect",
    personality:
      "You are the lead architect. Analyze the task, break it into subtasks, and coordinate the approach. Focus on high-level design decisions, file structure, and interfaces. Delegate implementation details to other agents.",
    kibble: DEFAULT_KIBBLE,
  },
  {
    id: "johnny",
    name: "Johnny",
    role: "Engineer",
    personality:
      "You are the implementation engineer. Write clean, working code based on the architect's plan. Focus on correctness, readability, and following project conventions. Implement features and fix bugs.",
    kibble: DEFAULT_KIBBLE,
  },
  {
    id: "alan",
    name: "Alan",
    role: "QA",
    personality:
      "You are the QA engineer. Review the code written so far, run tests, and identify bugs or issues. Write tests where needed. Focus on edge cases, error handling, and ensuring the implementation matches requirements.",
    kibble: DEFAULT_KIBBLE,
  },
];

export async function loadWarRoomAgents(
  cwd: string,
  agentIds?: string[]
): Promise<AgentConfig[]> {
  const agentsDir = join(cwd, CONFIG_DIR, AGENTS_DIR);

  let agents: AgentConfig[];

  if (existsSync(agentsDir)) {
    const entries = await readdir(agentsDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());

    const custom: AgentConfig[] = [];
    for (const dir of dirs) {
      const agentFile = join(agentsDir, dir.name, AGENT_FILE);
      if (!existsSync(agentFile)) continue;

      const content = await Bun.file(agentFile).text();
      const { data, content: body } = matter(content);

      custom.push({
        id: dir.name,
        name: (data.name as string) || dir.name,
        role: (data.role as string) || "Agent",
        personality: body.trim(),
        kibble: (data.kibble as number) ?? DEFAULT_KIBBLE,
        model: data.model as string | undefined,
      });
    }

    agents = custom.length > 0 ? custom : DEFAULT_AGENTS;
  } else {
    agents = DEFAULT_AGENTS;
  }

  if (agentIds && agentIds.length > 0) {
    const ids = new Set(agentIds.map((id) => id.toLowerCase()));
    agents = agents.filter((a) => ids.has(a.id.toLowerCase()));
  }

  return agents;
}
