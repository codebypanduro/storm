import { readdir } from "fs/promises";
import { join } from "path";
import { parsePrimitive } from "./frontmatter.js";
import type { PrimitiveEntry } from "../core/types.js";
import {
  CONFIG_DIR,
  CHECK_FILE,
  INSTRUCTION_FILE,
  CONTEXT_FILE,
  WORKFLOW_FILE,
  GENERATE_FILE,
} from "../core/constants.js";

const MARKER_FILES: Record<string, PrimitiveEntry["kind"]> = {
  [CHECK_FILE]: "check",
  [INSTRUCTION_FILE]: "instruction",
  [CONTEXT_FILE]: "context",
  [WORKFLOW_FILE]: "workflow",
};

export async function discoverPrimitives(
  cwd: string,
  kind: PrimitiveEntry["kind"]
): Promise<PrimitiveEntry[]> {
  const markerFile = Object.entries(MARKER_FILES).find(
    ([, k]) => k === kind
  )?.[0];
  if (!markerFile) return [];

  // For workflow, look directly in .storm/workflow/
  const kindDir =
    kind === "workflow" ? "workflow" : kind === "check" ? "checks" : `${kind}s`;
  const baseDir = join(cwd, CONFIG_DIR, kindDir);

  let entries: string[];
  try {
    entries = await readdir(baseDir);
  } catch {
    return [];
  }

  const results: PrimitiveEntry[] = [];

  for (const name of entries.sort()) {
    const filePath = join(baseDir, name, markerFile);
    try {
      const content = await Bun.file(filePath).text();
      const { frontmatter, body } = parsePrimitive(content);

      if (frontmatter.enabled === false) continue;

      results.push({ name, kind, frontmatter, body, filePath });
    } catch {
      // File doesn't exist, skip
    }
  }

  return results;
}

export async function discoverWorkflow(
  cwd: string
): Promise<PrimitiveEntry | null> {
  const filePath = join(cwd, CONFIG_DIR, "workflow", WORKFLOW_FILE);
  try {
    const content = await Bun.file(filePath).text();
    const { frontmatter, body } = parsePrimitive(content);
    return { name: "workflow", kind: "workflow", frontmatter, body, filePath };
  } catch {
    return null;
  }
}

export async function discoverGenerateWorkflow(
  cwd: string
): Promise<PrimitiveEntry | null> {
  const filePath = join(cwd, CONFIG_DIR, "generate", GENERATE_FILE);
  try {
    const content = await Bun.file(filePath).text();
    const { frontmatter, body } = parsePrimitive(content);
    return { name: "generate", kind: "workflow", frontmatter, body, filePath };
  } catch {
    return null;
  }
}
