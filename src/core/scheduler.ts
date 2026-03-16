import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { CONFIG_DIR } from "./constants.js";
import type { Schedule, ScheduleFile } from "./types.js";

const SCHEDULES_FILE = "schedules.json";

export function getSchedulesPath(cwd: string): string {
  return join(cwd, CONFIG_DIR, SCHEDULES_FILE);
}

export function loadSchedules(cwd: string): ScheduleFile {
  const path = getSchedulesPath(cwd);
  if (!existsSync(path)) {
    return { schedules: [] };
  }
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as ScheduleFile;
}

export function saveSchedules(cwd: string, file: ScheduleFile): void {
  const path = getSchedulesPath(cwd);
  writeFileSync(path, JSON.stringify(file, null, 2));
}

export function addSchedule(
  cwd: string,
  cron: string,
  options: { issueNumber?: number; description?: string }
): Schedule {
  validateCron(cron);
  const file = loadSchedules(cwd);
  const schedule: Schedule = {
    id: randomUUID().slice(0, 8),
    cron,
    issueNumber: options.issueNumber,
    description: options.description,
    createdAt: new Date().toISOString(),
  };
  file.schedules.push(schedule);
  saveSchedules(cwd, file);
  return schedule;
}

export function removeSchedule(cwd: string, id: string): boolean {
  const file = loadSchedules(cwd);
  const before = file.schedules.length;
  file.schedules = file.schedules.filter((s) => s.id !== id);
  if (file.schedules.length === before) return false;
  saveSchedules(cwd, file);
  return true;
}

export function updateLastRun(cwd: string, id: string): void {
  const file = loadSchedules(cwd);
  const schedule = file.schedules.find((s) => s.id === id);
  if (schedule) {
    schedule.lastRun = new Date().toISOString();
    saveSchedules(cwd, file);
  }
}

/**
 * Validate a 5-field cron expression: minute hour day month weekday
 * Supports: *, N, N-M, *\/N, N-M\/N (using * / N)
 */
export function validateCron(expr: string): void {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `Invalid cron expression "${expr}": expected 5 fields (minute hour day month weekday), got ${fields.length}`
    );
  }

  const ranges: [number, number][] = [
    [0, 59], // minute
    [0, 23], // hour
    [1, 31], // day
    [1, 12], // month
    [0, 6],  // weekday
  ];

  for (let i = 0; i < 5; i++) {
    validateField(fields[i], ranges[i][0], ranges[i][1], expr);
  }
}

function validateField(
  field: string,
  min: number,
  max: number,
  expr: string
): void {
  if (field === "*") return;

  // */N
  if (field.startsWith("*/")) {
    const n = parseInt(field.slice(2), 10);
    if (isNaN(n) || n < 1) {
      throw new Error(`Invalid cron expression "${expr}": invalid step "${field}"`);
    }
    return;
  }

  // N-M/N
  if (field.includes("/")) {
    const [range, step] = field.split("/");
    const stepN = parseInt(step, 10);
    if (isNaN(stepN) || stepN < 1) {
      throw new Error(`Invalid cron expression "${expr}": invalid step in "${field}"`);
    }
    validateField(range, min, max, expr);
    return;
  }

  // N-M
  if (field.includes("-")) {
    const [start, end] = field.split("-").map(Number);
    if (isNaN(start) || isNaN(end) || start < min || end > max || start > end) {
      throw new Error(
        `Invalid cron expression "${expr}": range "${field}" out of bounds [${min}-${max}]`
      );
    }
    return;
  }

  // Comma-separated list
  if (field.includes(",")) {
    for (const part of field.split(",")) {
      validateField(part.trim(), min, max, expr);
    }
    return;
  }

  // Single number
  const n = parseInt(field, 10);
  if (isNaN(n) || n < min || n > max) {
    throw new Error(
      `Invalid cron expression "${expr}": value "${field}" out of bounds [${min}-${max}]`
    );
  }
}

/**
 * Check whether a cron expression matches the given Date (minute precision).
 */
export function matchesCron(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  const [minuteF, hourF, dayF, monthF, weekdayF] = fields;

  return (
    fieldMatches(minuteF, date.getMinutes(), 0, 59) &&
    fieldMatches(hourF, date.getHours(), 0, 23) &&
    fieldMatches(dayF, date.getDate(), 1, 31) &&
    fieldMatches(monthF, date.getMonth() + 1, 1, 12) &&
    fieldMatches(weekdayF, date.getDay(), 0, 6)
  );
}

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  if (field === "*") return true;

  // */N
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    return (value - min) % step === 0;
  }

  // Comma-separated list
  if (field.includes(",")) {
    return field.split(",").some((part) => fieldMatches(part.trim(), value, min, max));
  }

  // N-M/step or N-M
  if (field.includes("-")) {
    const [rangePart, stepPart] = field.split("/");
    const [start, end] = rangePart.split("-").map(Number);
    if (value < start || value > end) return false;
    if (stepPart) {
      return (value - start) % parseInt(stepPart, 10) === 0;
    }
    return true;
  }

  return parseInt(field, 10) === value;
}

/**
 * Compute the next Date (after `from`) when the cron expression fires.
 * Searches forward up to ~1 year.
 */
export function nextRun(expr: string, from: Date = new Date()): Date | null {
  // Start from the next minute
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = new Date(from);
  limit.setFullYear(limit.getFullYear() + 1);

  while (candidate < limit) {
    if (matchesCron(expr, candidate)) {
      return new Date(candidate);
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null;
}

export function formatNextRun(expr: string): string {
  const next = nextRun(expr);
  if (!next) return "never";
  return next.toLocaleString();
}
