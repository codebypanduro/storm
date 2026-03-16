import { join } from "path";
import type { StormConfig } from "./types.js";
import { CONFIG_DIR, CONFIG_FILE } from "./constants.js";

const DEFAULT_CONFIG: StormConfig = {
  github: {
    repo: "",
    label: "storm",
    baseBranch: "main",
  },
  agent: {
    command: "claude",
    args: ["-p", "--dangerously-skip-permissions"],
    model: "sonnet",
  },
  defaults: {
    maxIterations: 10,
    delay: 2,
    stopOnError: false,
    parallel: false,
  },
};

export async function loadConfig(cwd: string): Promise<StormConfig> {
  const configPath = join(cwd, CONFIG_DIR, CONFIG_FILE);

  try {
    const raw = await Bun.file(configPath).json();
    return {
      github: { ...DEFAULT_CONFIG.github, ...raw.github },
      agent: { ...DEFAULT_CONFIG.agent, ...raw.agent },
      defaults: { ...DEFAULT_CONFIG.defaults, ...raw.defaults },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function getDefaultConfig(): StormConfig {
  return structuredClone(DEFAULT_CONFIG);
}

export function validateConfig(config: StormConfig): string[] {
  const errors: string[] = [];
  if (!config.github.repo) errors.push('github.repo is required (e.g. "owner/repo")');
  else if (!config.github.repo.includes("/")) errors.push('github.repo must be in "owner/repo" format');
  if (config.defaults.maxIterations < 1) errors.push("defaults.maxIterations must be >= 1");
  if (!config.agent.command) errors.push("agent.command is required");
  return errors;
}
