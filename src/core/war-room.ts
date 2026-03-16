import { join } from "path";
import { mkdirSync, appendFileSync, existsSync } from "fs";
import type {
  StormConfig,
  AgentConfig,
  WarRoomAgent,
  WarRoomEvent,
  WarRoomSession,
  WarRoomRenderer,
  KibbleTransfer,
} from "./types.js";
import {
  CONFIG_DIR,
  SESSIONS_DIR,
  EVENTS_FILE,
  STOP_MARKER,
  KIBBLE_TOOLS,
  TRANSFER_KIBBLE_MARKER,
  MAX_WAR_ROOM_TURNS,
} from "./constants.js";
import { log, formatDuration } from "./output.js";
import { PlainRenderer } from "./war-room-ui.js";

export function createWarRoomSession(
  task: string,
  agentConfigs: AgentConfig[],
  issueNumber?: number
): WarRoomSession {
  const agents: WarRoomAgent[] = agentConfigs.map((config) => ({
    config,
    kibbleRemaining: config.kibble,
    toolsUsed: 0,
  }));

  return {
    id: `war-room-${Date.now()}`,
    task,
    agents,
    events: [],
    turn: 0,
    maxTurns: MAX_WAR_ROOM_TURNS,
    startTime: Date.now(),
    issueNumber,
  };
}

export function buildAgentPrompt(
  agent: WarRoomAgent,
  task: string,
  events: WarRoomEvent[]
): string {
  const lines: string[] = [];

  lines.push(`# Role: ${agent.config.name} (${agent.config.role})`);
  lines.push("");
  lines.push(agent.config.personality);
  lines.push("");
  lines.push("# Task");
  lines.push(task);
  lines.push("");
  lines.push("# Kibble Budget");
  lines.push(`You have ${agent.kibbleRemaining} kibble remaining out of ${agent.config.kibble} total.`);
  lines.push("Each tool use that modifies or reads files costs 1 kibble.");
  lines.push("When you run out of kibble, your turn ends.");
  lines.push("");
  lines.push("# Collaboration");
  lines.push("You can transfer kibble to another agent by outputting:");
  lines.push(`${TRANSFER_KIBBLE_MARKER}:{amount}:{agent_name}%%`);
  lines.push("");
  lines.push(`When you have completed your part of the work, output ${STOP_MARKER} on its own line.`);

  if (events.length > 0) {
    lines.push("");
    lines.push("# Recent Events");
    lines.push(formatEventsForPrompt(events));
  }

  return lines.join("\n");
}

export function parseTransferKibble(output: string): KibbleTransfer | null {
  const regex = new RegExp(
    `${escapeRegex(TRANSFER_KIBBLE_MARKER)}:(\\d+):([^%]+)%%`
  );
  const match = output.match(regex);
  if (!match) return null;

  return {
    from: "", // caller fills this in
    to: match[2].trim(),
    amount: parseInt(match[1], 10),
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatEventsForPrompt(events: WarRoomEvent[], maxEvents = 20): string {
  const recent = events.slice(-maxEvents);
  return recent
    .map((e) => {
      const prefix = e.agent ? `[${e.agent}]` : "[system]";
      return `${prefix} ${e.message}`;
    })
    .join("\n");
}

export function appendEvent(sessionDir: string, event: WarRoomEvent): void {
  const eventsPath = join(sessionDir, EVENTS_FILE);
  appendFileSync(eventsPath, JSON.stringify(event) + "\n");
}

export async function spawnWarRoomAgent(
  prompt: string,
  config: StormConfig,
  agent: WarRoomAgent,
  cwd: string,
  renderer?: WarRoomRenderer,
  session?: WarRoomSession
): Promise<{ output: string; done: boolean; timedOut: boolean }> {
  const args = [
    ...config.agent.args,
    "--verbose",
    "--output-format",
    "stream-json",
    "--model",
    agent.config.model ?? config.agent.model,
  ];

  const proc = Bun.spawn([config.agent.command, ...args], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(prompt);
  proc.stdin.end();

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, 300_000);

  let output = "";
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === "result") {
            output = msg.result || "";
          } else if (msg.type === "assistant" && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === "tool_use") {
                if (KIBBLE_TOOLS.has(block.name)) {
                  agent.kibbleRemaining = Math.max(0, agent.kibbleRemaining - 1);
                }
                agent.toolsUsed++;
                if (renderer && session) {
                  renderer.onToolUse(session, agent, block.name);
                }
              }
            }
          }
        } catch {
          // Not JSON, skip
        }
      }
    }
  } finally {
    reader.releaseLock();
    clearTimeout(timer);
  }

  await proc.exited;

  const done = output.includes(STOP_MARKER);
  return { output, done, timedOut };
}

export async function runWarRoom(
  session: WarRoomSession,
  config: StormConfig,
  cwd: string,
  signal?: AbortSignal,
  renderer?: WarRoomRenderer
): Promise<WarRoomSession> {
  const ren = renderer ?? new PlainRenderer();
  const sessionDir = join(cwd, CONFIG_DIR, SESSIONS_DIR, session.id);

  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }

  ren.init(session);

  const systemEvent: WarRoomEvent = {
    type: "system",
    message: `War room started: ${session.task.slice(0, 100)}`,
    timestamp: Date.now(),
  };
  session.events.push(systemEvent);
  appendEvent(sessionDir, systemEvent);
  ren.onEvent(session, systemEvent);

  try {
    for (let turn = 1; turn <= session.maxTurns; turn++) {
      if (signal?.aborted) {
        ren.onAbort(session);
        break;
      }

      // Find next agent with kibble (round-robin)
      const agentIndex = (turn - 1) % session.agents.length;
      const agent = session.agents[agentIndex];

      if (agent.kibbleRemaining <= 0) {
        // Check if ALL agents are out of kibble
        const anyAlive = session.agents.some((a) => a.kibbleRemaining > 0);
        if (!anyAlive) {
          ren.onAllKibbleExhausted(session);
          break;
        }
        // Skip this agent, but still count the turn
        continue;
      }

      session.turn = turn;
      ren.onTurnStart(session, agent);

      const startEvent: WarRoomEvent = {
        type: "agent_start",
        agent: agent.config.name,
        message: `Starting turn ${turn}`,
        timestamp: Date.now(),
      };
      session.events.push(startEvent);
      appendEvent(sessionDir, startEvent);

      // Build prompt and spawn
      const prompt = buildAgentPrompt(agent, session.task, session.events);
      const result = await spawnWarRoomAgent(prompt, config, agent, cwd, ren, session);

      // Check for kibble transfer
      const transfer = parseTransferKibble(result.output);
      if (transfer) {
        transfer.from = agent.config.name;
        const target = session.agents.find(
          (a) => a.config.name.toLowerCase() === transfer.to.toLowerCase()
        );
        if (target) {
          const actual = Math.min(transfer.amount, agent.kibbleRemaining);
          agent.kibbleRemaining -= actual;
          target.kibbleRemaining += actual;
          transfer.amount = actual;
          ren.onTransfer(session, transfer);

          const transferEvent: WarRoomEvent = {
            type: "transfer",
            agent: agent.config.name,
            message: `Transferred ${actual} kibble to ${target.config.name}`,
            timestamp: Date.now(),
          };
          session.events.push(transferEvent);
          appendEvent(sessionDir, transferEvent);
        }
      }

      // Record end event
      const endEvent: WarRoomEvent = {
        type: "agent_end",
        agent: agent.config.name,
        message: result.done
          ? "Signaled done"
          : `Finished turn (kibble: ${agent.kibbleRemaining})`,
        timestamp: Date.now(),
      };
      session.events.push(endEvent);
      appendEvent(sessionDir, endEvent);

      ren.onTurnEnd(session, agent);

      if (result.timedOut) {
        ren.onTimeout(session, agent);
      }

      if (result.done) {
        ren.onDone(session, agent);
        break;
      }
    }

    ren.onComplete(session);
  } finally {
    ren.destroy();
  }

  return session;
}
