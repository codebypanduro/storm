import { discoverPrimitives } from "./discovery.js";

export async function loadInstructions(
  cwd: string
): Promise<Map<string, string>> {
  const entries = await discoverPrimitives(cwd, "instruction");
  const instructions = new Map<string, string>();

  for (const entry of entries) {
    instructions.set(entry.name, entry.body);
  }

  return instructions;
}
