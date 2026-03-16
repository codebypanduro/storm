import { join } from "path";
import { mkdirSync, appendFileSync } from "fs";
import type {
  StormConfig,
  WarRoomAgent,
  WarRoomEvent,
  WarRoomSession,
} from "./types.js";
import {
  CONFIG_DIR,
  SESSIONS_DIR,
  EVENTS_FILE,
  WAR_ROOM_NAME,
  STOP_MARKER,
  TRANSFER_KIBBLE_MARKER,
  MAX_WAR_ROOM_TURNS,
  KIBBLE_TOOLS,
} from "./constants.js";
import { log, formatDuration } from "./output.js";

function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function appendEvent(sessionDir: string, event: WarRoomEvent): void {
  const eventsPath = join(sessionDir, EVENTS_FILE);
  appendFileSync(eventsPath, JSON.stringify(event) + "\n", "utf-8");
}

export function formatEventsForPrompt(events: WarRoomEvent[], maxEvents = 20): string {
  const recent = events.slice(-maxEvents);
  if (recent.length === 0) return "(no events yet — you are the first to act)";
  return recent
    .map((e) => {
      const data = typeof e.data === "string" ? e.data : JSON.stringify(e.data);
      return `[${e.agent}] (${e.type}): ${data}`;
    })
    .join("\n");
}

export function buildAgentPrompt(
  agent: WarRoomAgent,
  task: string,
  events: WarRoomEvent[]
): string {
  const eventsText = formatEventsForPrompt(events);

  return `${agent.personality}

## Current Task

${task}

## Your Kibble Budget

You have ${agent.kibbleRemaining} kibble remaining. Each expensive tool use (bash commands, file edits, computer use) costs 1 kibble. Plan your actions accordingly. If you run out of kibble, you cannot act.

## War Room Activity (Recent Events)

${eventsText}

## Instructions

- Work collaboratively with the other agents to complete the task
- Use your built-in tools (bash, file editing) to make code changes
- To transfer some of your kibble budget to another agent, include this in your response:
  ${TRANSFER_KIBBLE_MARKER}{amount}:{agentName}%%
  Example: ${TRANSFER_KIBBLE_MARKER}5:Johnny%%
- When the entire task is fully complete and all changes are committed, output exactly:
  ${STOP_MARKER}
- Focus on your role: ${agent.role}

Now respond as ${agent.name} and take your next action:`;
}

export function parseTransferKibble(output: string): Array<{ amount: number; to: string }> {
  // TRANSFER_KIBBLE_MARKER is "%%TRANSFER_KIBBLE:" so pattern is %%TRANSFER_KIBBLE:{amount}:{name}%%
  const pattern = /%%TRANSFER_KIBBLE:(\d+):([\w]+)%%/g;
  const transfers: Array<{ amount: number; to: string }> = [];
  let match;
  while ((match = pattern.exec(output)) !== null) {
    transfers.push({ amount: parseInt(match[1], 10), to: match[2] });
  }
  return transfers;
}

interface WarRoomSpawnResult {
  output: string;
  kibbleCost: number;
  done: boolean;
  timedOut: boolean;
  sessionId?: string;
  durationMs: number;
}

async function spawnWarRoomAgent(
  prompt: string,
  config: StormConfig,
  agent: WarRoomAgent,
  cwd: string,
  timeout = 300_000
): Promise<WarRoomSpawnResult> {
  const args = [
    ...config.agent.args,
    "--verbose",
    "--output-format",
    "stream-json",
    "--model",
    agent.model,
  ];

  log.dim(`  [${agent.name}] $ ${config.agent.command} ${args.join(" ")}`);

  const start = Date.now();
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
  }, timeout);

  let output = "";
  let sessionId: string | undefined;
  let kibbleCost = 0;
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
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
              sessionId = msg.session_id ?? undefined;
            } else if (msg.type === "assistant" && msg.message?.content) {
              for (const block of msg.message.content) {
                if (block.type === "tool_use") {
                  log.dim(`  [${agent.name}][tool] ${block.name}`);
                  if (KIBBLE_TOOLS.has(block.name)) {
                    kibbleCost++;
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
    }

    const stderr = await new Response(proc.stderr).text();
    if (stderr.trim()) {
      log.dim(`  [${agent.name}][stderr] ${stderr.trim().slice(0, 200)}`);
    }

    await proc.exited;
  } finally {
    clearTimeout(timer);
  }

  const done = output.includes(STOP_MARKER);
  const durationMs = Date.now() - start;

  return { output, kibbleCost, done, timedOut, sessionId, durationMs };
}

export function createWarRoomSession(
  task: string,
  agents: WarRoomAgent[],
  issueNumber?: number
): WarRoomSession {
  return {
    id: generateSessionId(),
    task,
    agents,
    startedAt: Date.now(),
    done: false,
    issueNumber,
  };
}

export async function runWarRoom(
  session: WarRoomSession,
  config: StormConfig,
  cwd: string,
  signal?: AbortSignal
): Promise<{ success: boolean }> {
  const sessionDir = join(cwd, CONFIG_DIR, SESSIONS_DIR, session.id);
  mkdirSync(sessionDir, { recursive: true });

  const systemStart: WarRoomEvent = {
    ts: Date.now(),
    agent: "system",
    type: "system",
    room: WAR_ROOM_NAME,
    data: `War room started. Task: ${session.task.slice(0, 200)}. Agents: ${session.agents.map((a) => a.name).join(", ")}`,
  };
  appendEvent(sessionDir, systemStart);

  log.info(`War room session ${session.id} started with ${session.agents.length} agents`);
  for (const agent of session.agents) {
    log.dim(`  ${agent.name} (${agent.role}) — kibble: ${agent.kibbleRemaining}`);
  }

  const agents = session.agents;
  const events: WarRoomEvent[] = [systemStart];
  const start = Date.now();
  let turn = 0;
  let agentIndex = 0;
  let done = false;

  while (turn < MAX_WAR_ROOM_TURNS && !done) {
    if (signal?.aborted) {
      log.warn("Stop requested, finishing war room...");
      break;
    }

    // Find next agent with kibble remaining (round-robin)
    let found = false;
    for (let i = 0; i < agents.length; i++) {
      const candidate = agents[(agentIndex + i) % agents.length];
      if (candidate.kibbleRemaining > 0) {
        agentIndex = (agentIndex + i) % agents.length;
        found = true;
        break;
      }
    }

    if (!found) {
      log.warn("All agents have exhausted their kibble budget. Ending war room.");
      break;
    }

    const agent = agents[agentIndex];
    agentIndex = (agentIndex + 1) % agents.length;
    turn++;

    log.step(
      `Turn ${turn}/${MAX_WAR_ROOM_TURNS} — ${agent.name} (${agent.role}) [kibble: ${agent.kibbleRemaining}]`
    );

    const prompt = buildAgentPrompt(agent, session.task, events);
    const result = await spawnWarRoomAgent(prompt, config, agent, cwd);

    // Deduct kibble for this turn's tool usage
    agent.kibbleRemaining = Math.max(0, agent.kibbleRemaining - result.kibbleCost);
    agent.toolUseCount += result.kibbleCost;

    if (result.sessionId) {
      agent.sessionId = result.sessionId;
    }

    // Record talk event with agent's output
    const talkEvent: WarRoomEvent = {
      ts: Date.now(),
      agent: agent.name,
      type: "talk",
      room: WAR_ROOM_NAME,
      data: result.output.slice(0, 2000),
    };
    events.push(talkEvent);
    appendEvent(sessionDir, talkEvent);

    // Handle kibble transfers
    const transfers = parseTransferKibble(result.output);
    for (const transfer of transfers) {
      const target = agents.find(
        (a) =>
          a.name.toLowerCase() === transfer.to.toLowerCase() ||
          a.id.toLowerCase() === transfer.to.toLowerCase()
      );
      if (target && transfer.amount > 0 && agent.kibbleRemaining >= transfer.amount) {
        agent.kibbleRemaining -= transfer.amount;
        target.kibbleRemaining += transfer.amount;

        const kibbleEvent: WarRoomEvent = {
          ts: Date.now(),
          agent: agent.name,
          type: "transfer-kibble",
          room: WAR_ROOM_NAME,
          data: { to: target.name, amount: transfer.amount },
        };
        events.push(kibbleEvent);
        appendEvent(sessionDir, kibbleEvent);

        log.info(`${agent.name} transferred ${transfer.amount} kibble to ${target.name}`);
      }
    }

    log.dim(
      `  [${agent.name}] kibble remaining: ${agent.kibbleRemaining}, cost this turn: ${result.kibbleCost}, duration: ${formatDuration(result.durationMs)}`
    );

    if (result.done) {
      done = true;
      session.done = true;

      const doneEvent: WarRoomEvent = {
        ts: Date.now(),
        agent: agent.name,
        type: "done",
        room: WAR_ROOM_NAME,
        data: "Task complete",
      };
      events.push(doneEvent);
      appendEvent(sessionDir, doneEvent);

      log.success(`${agent.name} signaled task complete`);
    }

    if (result.timedOut) {
      log.error(`${agent.name} timed out on turn ${turn}`);
    }
  }

  const elapsed = formatDuration(Date.now() - start);

  if (!done) {
    log.warn(`War room ended after ${turn} turns without completion (${elapsed})`);
    return { success: false };
  }

  log.success(`War room complete in ${turn} turns (${elapsed})`);
  return { success: true };
}
