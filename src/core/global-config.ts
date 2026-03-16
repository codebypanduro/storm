import { join, resolve } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync } from "fs";
import type { GlobalConfig } from "./types.js";
import { CONFIG_DIR, CONFIG_FILE } from "./constants.js";

export const GLOBAL_CONFIG_DIR = join(homedir(), ".storm");
export const GLOBAL_CONFIG_FILE = join(GLOBAL_CONFIG_DIR, "global.json");

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = { projects: [] };

export async function loadGlobalConfig(): Promise<GlobalConfig> {
  try {
    const raw = await Bun.file(GLOBAL_CONFIG_FILE).json();
    return { projects: Array.isArray(raw.projects) ? raw.projects : [] };
  } catch {
    return { ...DEFAULT_GLOBAL_CONFIG, projects: [] };
  }
}

export async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
  if (!existsSync(GLOBAL_CONFIG_DIR)) {
    mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  }
  await Bun.write(GLOBAL_CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export async function addProject(inputPath: string): Promise<{ added: boolean; resolved: string; error?: string }> {
  const resolved = resolve(inputPath);
  const stormConfig = join(resolved, CONFIG_DIR, CONFIG_FILE);

  if (!existsSync(stormConfig)) {
    return { added: false, resolved, error: `No ${CONFIG_DIR}/${CONFIG_FILE} found at ${resolved}` };
  }

  const config = await loadGlobalConfig();
  const exists = config.projects.some((p) => p.path === resolved);
  if (exists) {
    return { added: false, resolved, error: `Project already registered: ${resolved}` };
  }

  config.projects.push({ path: resolved });
  await saveGlobalConfig(config);
  return { added: true, resolved };
}

export async function removeProject(inputPath: string): Promise<{ removed: boolean; resolved: string }> {
  const resolved = resolve(inputPath);
  const config = await loadGlobalConfig();
  const before = config.projects.length;
  config.projects = config.projects.filter((p) => p.path !== resolved);

  if (config.projects.length === before) {
    return { removed: false, resolved };
  }

  await saveGlobalConfig(config);
  return { removed: true, resolved };
}
