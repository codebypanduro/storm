import pc from "picocolors";

export const log = {
  info(msg: string) {
    console.log(pc.blue("info") + "  " + msg);
  },
  success(msg: string) {
    console.log(pc.green("pass") + "  " + msg);
  },
  error(msg: string) {
    console.log(pc.red("fail") + "  " + msg);
  },
  step(msg: string) {
    console.log(pc.cyan("step") + "  " + msg);
  },
  warn(msg: string) {
    console.log(pc.yellow("warn") + "  " + msg);
  },
  dim(msg: string) {
    console.log(pc.dim(msg));
  },
  issue(number: number, msg: string) {
    console.log(pc.magenta(`[#${number}]`) + " " + msg);
  },
};

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}
