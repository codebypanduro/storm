import pc from "picocolors";
import { log, formatDuration } from "./output.js";
import type {
  WarRoomRenderer,
  WarRoomSession,
  WarRoomAgent,
  WarRoomEvent,
  KibbleTransfer,
} from "./types.js";

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}

export function renderKibbleBar(remaining: number, total: number, width = 5): string {
  if (total <= 0) return "░".repeat(width);
  const filled = Math.round((remaining / total) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// --- PlainRenderer ---

export class PlainRenderer implements WarRoomRenderer {
  init(session: WarRoomSession): void {
    log.info(`War room started — ${session.agents.length} agent(s), max ${session.maxTurns} turns`);
    for (const agent of session.agents) {
      log.dim(`  ${agent.config.name} (${agent.config.role}) — kibble: ${agent.kibbleRemaining}`);
    }
  }

  destroy(): void {}

  onTurnStart(session: WarRoomSession, agent: WarRoomAgent): void {
    log.step(`Turn ${session.turn}/${session.maxTurns} — ${agent.config.name} (${agent.config.role})`);
  }

  onTurnEnd(_session: WarRoomSession, agent: WarRoomAgent): void {
    log.dim(`  ${agent.config.name}: kibble ${agent.kibbleRemaining}/${agent.config.kibble}, tools: ${agent.toolsUsed}`);
  }

  onToolUse(_session: WarRoomSession, agent: WarRoomAgent, toolName: string): void {
    log.dim(`  [${agent.config.name}] tool: ${toolName}`);
  }

  onEvent(_session: WarRoomSession, event: WarRoomEvent): void {
    const prefix = event.agent ? `[${event.agent}]` : "[system]";
    log.dim(`  ${prefix} ${event.message}`);
  }

  onTransfer(_session: WarRoomSession, transfer: KibbleTransfer): void {
    log.info(`Kibble transfer: ${transfer.from} → ${transfer.to} (${transfer.amount})`);
  }

  onDone(_session: WarRoomSession, agent: WarRoomAgent): void {
    log.success(`${agent.config.name} signaled done`);
  }

  onTimeout(_session: WarRoomSession, agent: WarRoomAgent): void {
    log.warn(`${agent.config.name} timed out`);
  }

  onAllKibbleExhausted(session: WarRoomSession): void {
    log.warn(`All agents exhausted their kibble after ${session.turn} turns`);
  }

  onAbort(session: WarRoomSession): void {
    log.warn(`War room aborted at turn ${session.turn}`);
  }

  onComplete(session: WarRoomSession): void {
    const elapsed = formatDuration(Date.now() - session.startTime);
    log.success(`War room complete — ${session.turn} turns, ${elapsed}`);
  }
}

// --- TuiRenderer ---

const LEFT_PANEL_WIDTH = 28;
const MIN_COLS = 60;
const MIN_ROWS = 10;
const STATUS_BAR_HEIGHT = 2;

export class TuiRenderer implements WarRoomRenderer {
  private events: WarRoomEvent[] = [];
  private session: WarRoomSession | null = null;
  private activeAgent: WarRoomAgent | null = null;
  private lastTool = "";
  private fallback: PlainRenderer | null = null;
  private resizeHandler: (() => void) | null = null;
  private stdinHandler: ((data: Buffer) => void) | null = null;
  private selectedAgentIndex = 0;
  private cols = 0;
  private rows = 0;

  init(session: WarRoomSession): void {
    this.cols = process.stdout.columns ?? 80;
    this.rows = process.stdout.rows ?? 24;

    if (this.cols < MIN_COLS || this.rows < MIN_ROWS) {
      this.fallback = new PlainRenderer();
      this.fallback.init(session);
      return;
    }

    this.session = session;
    this.events = [];

    // Enter alternate screen, hide cursor, clear screen
    process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J");

    this.resizeHandler = () => {
      this.cols = process.stdout.columns ?? 80;
      this.rows = process.stdout.rows ?? 24;
      if (this.session) this.render();
    };
    process.stdout.on("resize", this.resizeHandler);

    // Set up keyboard input for agent navigation
    if (process.stdin.isTTY) {
      this.stdinHandler = (data: Buffer) => {
        const key = data.toString();
        const agentCount = this.session?.agents.length ?? 0;
        if (agentCount === 0) return;

        let changed = false;
        if (key === "j" || key === "\x1b[B") {
          // Down
          this.selectedAgentIndex = (this.selectedAgentIndex + 1) % agentCount;
          changed = true;
        } else if (key === "k" || key === "\x1b[A") {
          // Up
          this.selectedAgentIndex = (this.selectedAgentIndex - 1 + agentCount) % agentCount;
          changed = true;
        } else if (key >= "1" && key <= "9") {
          const idx = parseInt(key, 10) - 1;
          if (idx < agentCount) {
            this.selectedAgentIndex = idx;
            changed = true;
          }
        }

        if (changed) this.render();
      };
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", this.stdinHandler);
    }

    this.addEvent({ type: "system", message: "War room started", timestamp: Date.now() });
    this.render();
  }

  destroy(): void {
    if (this.fallback) {
      this.fallback.destroy();
      return;
    }

    if (this.stdinHandler) {
      process.stdin.off("data", this.stdinHandler);
      this.stdinHandler = null;
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
      }
    }

    if (this.resizeHandler) {
      process.stdout.off("resize", this.resizeHandler);
      this.resizeHandler = null;
    }

    // Leave alternate screen, show cursor
    process.stdout.write("\x1b[?1049l\x1b[?25h");

    // Print summary
    if (this.session) {
      const elapsed = formatDuration(Date.now() - this.session.startTime);
      log.info(`War room finished — ${this.session.turn} turns, ${elapsed}`);
      for (const agent of this.session.agents) {
        log.dim(`  ${agent.config.name}: kibble ${agent.kibbleRemaining}/${agent.config.kibble}, tools: ${agent.toolsUsed}`);
      }
    }
  }

  onTurnStart(session: WarRoomSession, agent: WarRoomAgent): void {
    if (this.fallback) { this.fallback.onTurnStart(session, agent); return; }
    this.session = session;
    this.activeAgent = agent;
    this.lastTool = "";
    this.addEvent({ type: "agent_start", agent: agent.config.name, message: `Starting turn ${session.turn}`, timestamp: Date.now() });
    this.render();
  }

  onTurnEnd(session: WarRoomSession, agent: WarRoomAgent): void {
    if (this.fallback) { this.fallback.onTurnEnd(session, agent); return; }
    this.session = session;
    this.render();
  }

  onToolUse(session: WarRoomSession, agent: WarRoomAgent, toolName: string): void {
    if (this.fallback) { this.fallback.onToolUse(session, agent, toolName); return; }
    this.session = session;
    this.lastTool = toolName;
    this.addEvent({ type: "tool_use", agent: agent.config.name, message: `[tool] ${toolName}`, timestamp: Date.now() });
    this.render();
  }

  onEvent(session: WarRoomSession, event: WarRoomEvent): void {
    if (this.fallback) { this.fallback.onEvent(session, event); return; }
    this.session = session;
    this.addEvent(event);
    this.render();
  }

  onTransfer(session: WarRoomSession, transfer: KibbleTransfer): void {
    if (this.fallback) { this.fallback.onTransfer(session, transfer); return; }
    this.session = session;
    this.addEvent({ type: "transfer", message: `Kibble: ${transfer.from} → ${transfer.to} (${transfer.amount})`, timestamp: Date.now() });
    this.render();
  }

  onDone(session: WarRoomSession, agent: WarRoomAgent): void {
    if (this.fallback) { this.fallback.onDone(session, agent); return; }
    this.session = session;
    this.addEvent({ type: "system", agent: agent.config.name, message: "Signaled done", timestamp: Date.now() });
    this.render();
  }

  onTimeout(session: WarRoomSession, agent: WarRoomAgent): void {
    if (this.fallback) { this.fallback.onTimeout(session, agent); return; }
    this.session = session;
    this.addEvent({ type: "error", agent: agent.config.name, message: "Timed out", timestamp: Date.now() });
    this.render();
  }

  onAllKibbleExhausted(session: WarRoomSession): void {
    if (this.fallback) { this.fallback.onAllKibbleExhausted(session); return; }
    this.session = session;
    this.addEvent({ type: "system", message: "All agents exhausted their kibble", timestamp: Date.now() });
    this.render();
  }

  onAbort(session: WarRoomSession): void {
    if (this.fallback) { this.fallback.onAbort(session); return; }
    this.session = session;
    this.addEvent({ type: "system", message: "Aborted", timestamp: Date.now() });
    this.render();
  }

  onComplete(session: WarRoomSession): void {
    if (this.fallback) { this.fallback.onComplete(session); return; }
    this.session = session;
    this.addEvent({ type: "system", message: "Complete", timestamp: Date.now() });
    this.render();
  }

  private addEvent(event: WarRoomEvent): void {
    this.events.push(event);
  }

  private render(): void {
    if (!this.session) return;

    const { cols, rows } = this;
    const rightWidth = cols - LEFT_PANEL_WIDTH - 1; // -1 for separator
    const contentHeight = rows - STATUS_BAR_HEIGHT - 2; // -2 for top/bottom borders

    let output = "";

    // Move cursor to top-left
    output += "\x1b[H";

    // Top border
    output += pc.dim("┌─ Agents ") + pc.dim("─".repeat(LEFT_PANEL_WIDTH - 10)) + pc.dim("┬─ Events ") + pc.dim("─".repeat(Math.max(0, rightWidth - 10))) + pc.dim("┐") + "\x1b[K\n";

    // Content rows
    const agentLines = this.buildAgentPanel(contentHeight);
    const eventLines = this.buildEventPanel(contentHeight, rightWidth);

    for (let i = 0; i < contentHeight; i++) {
      const left = (agentLines[i] ?? "").padEnd(LEFT_PANEL_WIDTH);
      const right = (eventLines[i] ?? "").padEnd(rightWidth);
      output += pc.dim("│") + " " + truncate(left, LEFT_PANEL_WIDTH - 1) + pc.dim("│") + " " + truncate(right, rightWidth - 1) + pc.dim("│") + "\x1b[K\n";
    }

    // Status bar separator
    output += pc.dim("├─ Status ") + pc.dim("─".repeat(LEFT_PANEL_WIDTH - 10)) + pc.dim("┴") + pc.dim("─".repeat(Math.max(0, rightWidth))) + pc.dim("┤") + "\x1b[K\n";

    // Status bar content
    const elapsed = formatDuration(Date.now() - this.session.startTime);
    const agentName = this.activeAgent ? `${this.activeAgent.config.name} (${this.activeAgent.config.role})` : "—";
    const toolInfo = this.lastTool ? `[tool] ${this.lastTool}` : "";
    const navHint = "[j/k] navigate";
    const statusText = `Turn ${this.session.turn}/${this.session.maxTurns} | ${agentName} | ${toolInfo} | ${navHint} | elapsed: ${elapsed}`;
    const statusPadded = truncate(statusText, cols - 4).padEnd(cols - 4);
    output += pc.dim("│") + " " + pc.cyan(statusPadded) + " " + pc.dim("│") + "\x1b[K\n";

    // Bottom border — no trailing \n, then clear everything below
    output += pc.dim("└") + pc.dim("─".repeat(cols - 2)) + pc.dim("┘") + "\x1b[J";

    process.stdout.write(output);
  }

  private buildAgentPanel(height: number): string[] {
    if (!this.session) return [];
    const lines: string[] = [];

    for (let idx = 0; idx < this.session.agents.length; idx++) {
      const agent = this.session.agents[idx];
      if (lines.length >= height) break;
      const isActive = this.activeAgent?.config.id === agent.config.id;
      const isSelected = idx === this.selectedAgentIndex;

      let prefix: string;
      if (isActive && isSelected) {
        prefix = pc.green("> ");
      } else if (isActive) {
        prefix = pc.green("> ");
      } else if (isSelected) {
        prefix = pc.cyan("* ");
      } else {
        prefix = "  ";
      }

      const name = isActive ? pc.bold(agent.config.name) : isSelected ? pc.cyan(agent.config.name) : agent.config.name;
      lines.push(`${prefix}${name} (${agent.config.role})`);

      if (lines.length >= height) break;
      const bar = renderKibbleBar(agent.kibbleRemaining, agent.config.kibble);
      const color = agent.kibbleRemaining > 0 ? pc.green : pc.red;
      lines.push(`  kibble: ${agent.kibbleRemaining}/${agent.config.kibble} ${color(bar)}`);

      if (lines.length >= height) break;
      lines.push(`  tools: ${agent.toolsUsed}`);

      // Show last event for the selected agent
      if (isSelected && lines.length < height) {
        const lastEvent = [...this.events].reverse().find((e) => e.agent === agent.config.name);
        if (lastEvent) {
          lines.push(`  ${pc.dim(truncate(lastEvent.message, LEFT_PANEL_WIDTH - 4))}`);
        }
      }

      if (lines.length >= height) break;
      lines.push("");
    }

    return lines;
  }

  private buildEventPanel(height: number, _width: number): string[] {
    // Show the last N events that fit
    const visible = this.events.slice(-height);
    return visible.map((e) => {
      const prefix = e.agent ? pc.yellow(`[${e.agent}]`) : pc.blue("[system]");
      return `${prefix} ${e.message}`;
    });
  }
}

export function createRenderer(ui: boolean): WarRoomRenderer {
  if (ui && process.stdout.isTTY) {
    return new TuiRenderer();
  }
  return new PlainRenderer();
}
