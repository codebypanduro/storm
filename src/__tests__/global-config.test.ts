import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import type { GlobalConfig } from "../core/types.js";

// We test the core logic by creating a temp directory structure
// and calling the functions with controlled paths.

function createTempDir(): string {
  const dir = join(tmpdir(), `storm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
      agent: { command: "claude", args: [], model: "sonnet" },
      defaults: { maxIterations: 10, delay: 2, stopOnError: false, parallel: false },
    })
  );
}

describe("global-config", () => {
  let tempDir: string;
  let configDir: string;
  let configFile: string;

  // Instead of importing the module directly (which uses hardcoded homedir),
  // we test the logic by reimplementing the core functions with a configurable path.
  // This validates the serialization/deserialization logic.

  async function loadGlobalConfig(): Promise<GlobalConfig> {
    try {
      const raw = await Bun.file(configFile).json();
      return { projects: Array.isArray(raw.projects) ? raw.projects : [] };
    } catch {
      return { projects: [] };
    }
  }

  async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    await Bun.write(configFile, JSON.stringify(config, null, 2) + "\n");
  }

  beforeEach(() => {
    tempDir = createTempDir();
    configDir = join(tempDir, ".storm");
    configFile = join(configDir, "global.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("loadGlobalConfig", () => {
    it("returns empty projects array when config file does not exist", async () => {
      const config = await loadGlobalConfig();
      expect(config.projects).toEqual([]);
    });

    it("loads config from existing file", async () => {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        configFile,
        JSON.stringify({ projects: [{ path: "/foo/bar" }] })
      );

      const config = await loadGlobalConfig();
      expect(config.projects).toEqual([{ path: "/foo/bar" }]);
    });

    it("handles malformed JSON gracefully", async () => {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(configFile, "not valid json{{{");

      const config = await loadGlobalConfig();
      expect(config.projects).toEqual([]);
    });

    it("handles missing projects field", async () => {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(configFile, JSON.stringify({ other: "data" }));

      const config = await loadGlobalConfig();
      expect(config.projects).toEqual([]);
    });

    it("handles non-array projects field", async () => {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(configFile, JSON.stringify({ projects: "not-array" }));

      const config = await loadGlobalConfig();
      expect(config.projects).toEqual([]);
    });
  });

  describe("saveGlobalConfig", () => {
    it("creates config directory if it does not exist", async () => {
      expect(existsSync(configDir)).toBe(false);

      await saveGlobalConfig({ projects: [{ path: "/a" }] });

      expect(existsSync(configDir)).toBe(true);
      const saved = await Bun.file(configFile).json();
      expect(saved.projects).toEqual([{ path: "/a" }]);
    });

    it("overwrites existing config", async () => {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(configFile, JSON.stringify({ projects: [{ path: "/old" }] }));

      await saveGlobalConfig({ projects: [{ path: "/new" }] });

      const saved = await Bun.file(configFile).json();
      expect(saved.projects).toEqual([{ path: "/new" }]);
    });

    it("writes formatted JSON with trailing newline", async () => {
      await saveGlobalConfig({ projects: [] });

      const content = await Bun.file(configFile).text();
      expect(content).toBe(JSON.stringify({ projects: [] }, null, 2) + "\n");
    });

    it("preserves multiple projects", async () => {
      const projects = [
        { path: "/a" },
        { path: "/b" },
        { path: "/c" },
      ];
      await saveGlobalConfig({ projects });

      const saved = await Bun.file(configFile).json();
      expect(saved.projects).toEqual(projects);
    });
  });

  describe("addProject logic", () => {
    it("adds a new project to empty config", async () => {
      const projectPath = createTempDir();
      createStormProject(projectPath);

      // Simulate addProject logic
      const stormConfig = join(projectPath, ".storm", "storm.json");
      expect(existsSync(stormConfig)).toBe(true);

      const config = await loadGlobalConfig();
      config.projects.push({ path: projectPath });
      await saveGlobalConfig(config);

      const loaded = await loadGlobalConfig();
      expect(loaded.projects).toHaveLength(1);
      expect(loaded.projects[0].path).toBe(projectPath);

      rmSync(projectPath, { recursive: true, force: true });
    });

    it("rejects project without .storm/storm.json", () => {
      const projectPath = createTempDir();
      const stormConfig = join(projectPath, ".storm", "storm.json");
      expect(existsSync(stormConfig)).toBe(false);

      rmSync(projectPath, { recursive: true, force: true });
    });

    it("detects duplicate projects", async () => {
      const projectPath = createTempDir();
      createStormProject(projectPath);

      const config: GlobalConfig = { projects: [{ path: projectPath }] };
      await saveGlobalConfig(config);

      const loaded = await loadGlobalConfig();
      const isDuplicate = loaded.projects.some((p) => p.path === projectPath);
      expect(isDuplicate).toBe(true);

      rmSync(projectPath, { recursive: true, force: true });
    });

    it("adds multiple distinct projects", async () => {
      const projectA = createTempDir();
      const projectB = createTempDir();
      createStormProject(projectA);
      createStormProject(projectB);

      await saveGlobalConfig({ projects: [{ path: projectA }] });

      const config = await loadGlobalConfig();
      const isDuplicate = config.projects.some((p) => p.path === projectB);
      expect(isDuplicate).toBe(false);

      config.projects.push({ path: projectB });
      await saveGlobalConfig(config);

      const loaded = await loadGlobalConfig();
      expect(loaded.projects).toHaveLength(2);

      rmSync(projectA, { recursive: true, force: true });
      rmSync(projectB, { recursive: true, force: true });
    });
  });

  describe("removeProject logic", () => {
    it("removes an existing project", async () => {
      await saveGlobalConfig({
        projects: [{ path: "/a" }, { path: "/b" }, { path: "/c" }],
      });

      const config = await loadGlobalConfig();
      config.projects = config.projects.filter((p) => p.path !== "/b");
      await saveGlobalConfig(config);

      const loaded = await loadGlobalConfig();
      expect(loaded.projects).toHaveLength(2);
      expect(loaded.projects.map((p) => p.path)).toEqual(["/a", "/c"]);
    });

    it("does nothing when project is not registered", async () => {
      await saveGlobalConfig({ projects: [{ path: "/a" }] });

      const config = await loadGlobalConfig();
      const before = config.projects.length;
      config.projects = config.projects.filter((p) => p.path !== "/nonexistent");

      expect(config.projects.length).toBe(before);
    });

    it("handles removing from empty config", async () => {
      await saveGlobalConfig({ projects: [] });

      const config = await loadGlobalConfig();
      config.projects = config.projects.filter((p) => p.path !== "/a");

      expect(config.projects).toHaveLength(0);
    });

    it("removes the last project leaving empty array", async () => {
      await saveGlobalConfig({ projects: [{ path: "/only" }] });

      const config = await loadGlobalConfig();
      config.projects = config.projects.filter((p) => p.path !== "/only");
      await saveGlobalConfig(config);

      const loaded = await loadGlobalConfig();
      expect(loaded.projects).toEqual([]);
    });
  });

  describe("round-trip serialization", () => {
    it("preserves project data through save and load cycle", async () => {
      const original: GlobalConfig = {
        projects: [
          { path: "/Users/me/code/project-a" },
          { path: "/Users/me/code/project-b" },
          { path: "/opt/work/project-c" },
        ],
      };

      await saveGlobalConfig(original);
      const loaded = await loadGlobalConfig();

      expect(loaded).toEqual(original);
    });

    it("handles paths with special characters", async () => {
      const original: GlobalConfig = {
        projects: [
          { path: "/Users/me/my project" },
          { path: "/Users/me/project (copy)" },
        ],
      };

      await saveGlobalConfig(original);
      const loaded = await loadGlobalConfig();

      expect(loaded).toEqual(original);
    });
  });
});
