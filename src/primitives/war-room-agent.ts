import { existsSync } from "fs";
import { join } from "path";
import matter from "gray-matter";
import type { WarRoomAgent } from "../core/types.js";
import { CONFIG_DIR, AGENTS_DIR, AGENT_FILE, DEFAULT_KIBBLE } from "../core/constants.js";

const DEFAULT_AGENTS: WarRoomAgent[] = [
  {
    id: "architect",
    name: "Storm",
    role: "Architect",
    kibble: DEFAULT_KIBBLE,
    kibbleRemaining: DEFAULT_KIBBLE,
    model: "sonnet",
    toolUseCount: 0,
    personality: `You are Storm, a senior software architect. You read the issue carefully, create a detailed implementation plan, and delegate clear tasks to the Engineer. Ask clarifying questions when the spec is ambiguous. Always think about edge cases and architecture before diving into code.`,
  },
  {
    id: "engineer",
    name: "Johnny",
    role: "Engineer",
    kibble: DEFAULT_KIBBLE,
    kibbleRemaining: DEFAULT_KIBBLE,
    model: "sonnet",
    toolUseCount: 0,
    personality: `You are Johnny, a pragmatic senior engineer. You implement what the Architect specifies, ask clarifying questions when the spec is unclear, and always run the typecheck before declaring work done. You write clean, tested code and commit your changes.`,
  },
  {
    id: "qa",
    name: "Alan",
    role: "QA",
    kibble: DEFAULT_KIBBLE,
    kibbleRemaining: DEFAULT_KIBBLE,
    model: "sonnet",
    toolUseCount: 0,
    personality: `You are Alan, a meticulous QA engineer. You run tests, check for edge cases, review the Engineer's code for correctness and quality, and report failures back to the room. You verify the implementation satisfies the original requirements before signing off.`,
  },
];

export async function loadWarRoomAgents(
  cwd: string,
  agentIds?: string[]
): Promise<WarRoomAgent[]> {
  const agentsDir = join(cwd, CONFIG_DIR, AGENTS_DIR);

  if (!existsSync(agentsDir)) {
    return filterAgents(DEFAULT_AGENTS, agentIds);
  }

  const dir = await Bun.file(agentsDir).exists().catch(() => false);
  if (!dir) {
    return filterAgents(DEFAULT_AGENTS, agentIds);
  }

  // Read subdirectories
  const { readdirSync } = await import("fs");
  const entries = readdirSync(agentsDir, { withFileTypes: true }).filter((d) =>
    d.isDirectory()
  );

  const targetEntries = agentIds
    ? entries.filter((d) => agentIds.includes(d.name))
    : entries;

  if (targetEntries.length === 0) {
    return filterAgents(DEFAULT_AGENTS, agentIds);
  }

  const agents: WarRoomAgent[] = [];

  for (const entry of targetEntries) {
    const agentFilePath = join(agentsDir, entry.name, AGENT_FILE);
    const agentFile = Bun.file(agentFilePath);
    if (!(await agentFile.exists())) continue;

    const content = await agentFile.text();
    const { data, content: body } = matter(content);

    const kibble = (data.kibble as number | undefined) ?? DEFAULT_KIBBLE;

    agents.push({
      id: entry.name,
      name: (data.name as string | undefined) ?? entry.name,
      role: (data.role as string | undefined) ?? entry.name,
      kibble,
      kibbleRemaining: kibble,
      model: (data.model as string | undefined) ?? "sonnet",
      toolUseCount: 0,
      personality: body.trim(),
    });
  }

  return agents.length > 0 ? agents : filterAgents(DEFAULT_AGENTS, agentIds);
}

function filterAgents(agents: WarRoomAgent[], agentIds?: string[]): WarRoomAgent[] {
  if (!agentIds || agentIds.length === 0) return agents;
  const filtered = agents.filter((a) => agentIds.includes(a.id));
  return filtered.length > 0 ? filtered : agents;
}
