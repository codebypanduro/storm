import { log } from "../core/output.js";
import { spawnSync } from "child_process";
import { join } from "path";
import { homedir } from "os";

const INSTALL_DIR = join(homedir(), ".storm-agent");

export async function updateCommand() {
  const installDir = Bun.file(join(INSTALL_DIR, "package.json"));
  if (!(await installDir.exists())) {
    log.error(`storm-agent not found at ${INSTALL_DIR}`);
    log.info("If you installed manually, update by pulling the latest changes in your install directory.");
    process.exit(1);
  }

  log.info("Updating storm-agent...");

  const pull = spawnSync("git", ["pull"], { cwd: INSTALL_DIR, stdio: "inherit" });
  if (pull.status !== 0) {
    log.error("git pull failed");
    process.exit(1);
  }

  const install = spawnSync("bun", ["install"], { cwd: INSTALL_DIR, stdio: "inherit" });
  if (install.status !== 0) {
    log.error("bun install failed");
    process.exit(1);
  }

  log.success("storm-agent updated successfully");
}
