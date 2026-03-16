export const STOP_MARKER = "%%STORM_DONE%%";
export const ISSUE_START_MARKER = "%%STORM_ISSUE_START%%";
export const ISSUE_END_MARKER = "%%STORM_ISSUE_END%%";
export const CONFIG_DIR = ".storm";
export const CONFIG_FILE = "storm.json";
export const WORKFLOW_FILE = "WORKFLOW.md";
export const GENERATE_FILE = "GENERATE.md";
export const CHECK_FILE = "CHECK.md";
export const INSTRUCTION_FILE = "INSTRUCTION.md";
export const CONTEXT_FILE = "CONTEXT.md";
export const PR_DESCRIPTION_FILE = "PR_DESCRIPTION.md";
export const CONTINUE_FILE = "CONTINUE.md";

// War-room constants
export const AGENTS_DIR = "agents";
export const AGENT_FILE = "AGENT.md";
export const SESSIONS_DIR = "sessions";
export const EVENTS_FILE = "events.jsonl";
export const WAR_ROOM_NAME = "war-room";
export const DEFAULT_KIBBLE = 20;
export const KIBBLE_TOOLS = new Set(["bash", "computer", "str_replace_based_edit_tool", "create_file", "delete_file"]);
export const TRANSFER_KIBBLE_MARKER = "%%TRANSFER_KIBBLE:";
export const MAX_WAR_ROOM_TURNS = 30;
