import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { join, resolve } from "path";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import {
  loadGlobalConfig,
  saveGlobalConfig,
  addProject,
  removeProject,
  GLOBAL_CONFIG_DIR,
  GLOBAL_CONFIG_FILE,
} from "../core/global-config.js";

function createTempDir(): string {
  const dir = join(tmpdir(), `storm-global-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createStormProject(projectPath: string): void {
  const stormDir = join(projectPath, ".storm");
  mkdirSync(stormDir, { recursive: true });
  writeFileSync(
    join(stormDir, "storm.json"),
    JSON.stringify({
      github: { repo: "owner/repo", label: "storm", baseBranch: "main" },
    })
  );
}

describe("global-config module exports", () => {
  it("exports correct global config path constants", () => {
    expect(GLOBAL_CONFIG_DIR).toContain(".storm");
    expect(GLOBAL_CONFIG_FILE).toContain("global.json");
  });
});

describe("addProject", () => {
  // We need to back up and restore the real global config
  let originalContent: string | null = null;

  beforeEach(() => {
    try {
      originalContent = readFileSync(GLOBAL_CONFIG_FILE, "utf-8");
    } catch {
      originalContent = null;
    }
    // Start with clean config
    if (existsSync(GLOBAL_CONFIG_FILE)) {
      writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify({ projects: [] }));
    }
  });

  afterEach(() => {
    if (originalContent !== null) {
      writeFileSync(GLOBAL_CONFIG_FILE, originalContent);
    } else if (existsSync(GLOBAL_CONFIG_FILE)) {
      rmSync(GLOBAL_CONFIG_FILE);
    }
  });

  it("adds a valid project", async () => {
    const projectPath = createTempDir();
    createStormProject(projectPath);

    const result = await addProject(projectPath);
    expect(result.added).toBe(true);
    expect(result.resolved).toBe(resolve(projectPath));

    const config = await loadGlobalConfig();
    expect(config.projects.some((p) => p.path === resolve(projectPath))).toBe(true);

    rmSync(projectPath, { recursive: true, force: true });
  });

  it("rejects project without storm config", async () => {
    const projectPath = createTempDir();
    // No .storm/storm.json created

    const result = await addProject(projectPath);
    expect(result.added).toBe(false);
    expect(result.error).toContain("No .storm/storm.json found");

    rmSync(projectPath, { recursive: true, force: true });
  });

  it("rejects duplicate project", async () => {
    const projectPath = createTempDir();
    createStormProject(projectPath);

    const first = await addProject(projectPath);
    expect(first.added).toBe(true);

    const second = await addProject(projectPath);
    expect(second.added).toBe(false);
    expect(second.error).toContain("already registered");

    rmSync(projectPath, { recursive: true, force: true });
  });

  it("resolves relative path to absolute", async () => {
    // Create a project in a known temp location
    const projectPath = createTempDir();
    createStormProject(projectPath);

    const result = await addProject(projectPath);
    expect(result.resolved).toBe(resolve(projectPath));
    // The resolved path should be absolute
    expect(result.resolved.startsWith("/")).toBe(true);

    rmSync(projectPath, { recursive: true, force: true });
  });
});

describe("removeProject", () => {
  let originalContent: string | null = null;

  beforeEach(() => {
    try {
      originalContent = readFileSync(GLOBAL_CONFIG_FILE, "utf-8");
    } catch {
      originalContent = null;
    }
  });

  afterEach(() => {
    if (originalContent !== null) {
      writeFileSync(GLOBAL_CONFIG_FILE, originalContent);
    } else if (existsSync(GLOBAL_CONFIG_FILE)) {
      rmSync(GLOBAL_CONFIG_FILE);
    }
  });

  it("removes an existing project", async () => {
    const projectPath = createTempDir();
    createStormProject(projectPath);

    // Add first
    await addProject(projectPath);
    const resolved = resolve(projectPath);

    // Verify it's there
    let config = await loadGlobalConfig();
    expect(config.projects.some((p) => p.path === resolved)).toBe(true);

    // Remove
    const result = await removeProject(projectPath);
    expect(result.removed).toBe(true);

    // Verify it's gone
    config = await loadGlobalConfig();
    expect(config.projects.some((p) => p.path === resolved)).toBe(false);

    rmSync(projectPath, { recursive: true, force: true });
  });

  it("returns false for non-registered project", async () => {
    await saveGlobalConfig({ projects: [] });

    const result = await removeProject("/nonexistent/path");
    expect(result.removed).toBe(false);
  });

  it("only removes the specified project", async () => {
    const projectA = createTempDir();
    const projectB = createTempDir();
    createStormProject(projectA);
    createStormProject(projectB);

    await addProject(projectA);
    await addProject(projectB);

    await removeProject(projectA);

    const config = await loadGlobalConfig();
    expect(config.projects).toHaveLength(1);
    expect(config.projects[0].path).toBe(resolve(projectB));

    rmSync(projectA, { recursive: true, force: true });
    rmSync(projectB, { recursive: true, force: true });
  });
});
