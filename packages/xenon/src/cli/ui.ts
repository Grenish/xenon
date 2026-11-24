/**
 * Zero-dependency terminal UI shared by `xenon-cms init` and `create-xenon-app` (which bundles it).
 *
 * Plain output when stdout isn't a TTY, `NO_COLOR` is set, or `TERM=dumb`; `FORCE_COLOR` forces color.
 * Interactive pieces (select, text, spinner) are only used when both stdin and stdout are TTYs.
 */
import { spawn } from "node:child_process";
import { emitKeypressEvents } from "node:readline";

// ---------------------------------------------------------------------------------------------
// Color & symbols
// ---------------------------------------------------------------------------------------------

function supportsColor(stream: NodeJS.WriteStream = process.stdout): boolean {
  const env = process.env;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
  if (env.TERM === "dumb") return false;
  return Boolean(stream.isTTY);
}

let colorEnabled = supportsColor();

/** Override color detection (tests, `--no-color`). */
export function setColor(enabled: boolean): void {
  colorEnabled = enabled;
}

const wrap = (open: number, close: number) => (text: string) =>
  colorEnabled ? `\u001B[${open}m${text}\u001B[${close}m` : text;

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};

/** Xenon's brand teal on 256-color terminals, cyan otherwise. */
export function brand(text: string): string {
  if (!colorEnabled) return text;
  return process.env.COLORTERM || /256|truecolor/.test(process.env.TERM ?? "") ? `\u001B[38;5;37m${text}\u001B[39m` : c.cyan(text);
}

const unicode = process.platform !== "win32" || Boolean(process.env.WT_SESSION || process.env.TERM_PROGRAM);

export const sym = unicode
  ? { mark: "◆", done: "◇", ok: "✔", warn: "▲", error: "✖", radioOn: "●", radioOff: "○", bar: "│", add: "+", update: "~", skip: "–", arrow: "→" }
  : { mark: "*", done: "o", ok: "√", warn: "!", error: "x", radioOn: ">", radioOff: " ", bar: "|", add: "+", update: "~", skip: "-", arrow: "->" };

const ANSI = /\u001B\[[0-9;?]*[A-Za-z]/g;
export const visibleLength = (text: string) => text.replace(ANSI, "").length;
const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - visibleLength(text)));

// ---------------------------------------------------------------------------------------------
// Static blocks (return strings; callers decide where to print)
// ---------------------------------------------------------------------------------------------

export function intro(title: string, version: string): string {
  return `\n  ${brand(c.bold(`${sym.mark} Xenon`))}  ${c.bold(title)} ${c.dim(`v${version}`)}\n`;
}

/** A settled answer, e.g. `◇ Framework  Next.js (App Router)  detected`. */
export function answer(label: string, value: string, note?: string, labelWidth = 10): string {
  return `  ${c.gray(sym.done)} ${pad(c.dim(label), labelWidth)}  ${value}${note ? `  ${c.dim(note)}` : ""}`;
}

export function heading(title: string): string {
  return `\n  ${c.bold(title)}`;
}

export interface FileRow {
  path: string;
  action: "created" | "updated" | "skipped";
}

export function fileRows(files: readonly FileRow[], options: { dryRun?: boolean; verbs?: boolean } = {}): string[] {
  const width = Math.min(56, Math.max(0, ...files.map((f) => f.path.length)));
  return files.map((file) => {
    const marker =
      file.action === "created" ? c.green(sym.add) : file.action === "updated" ? c.yellow(sym.update) : c.gray(sym.skip);
    const path = file.action === "skipped" ? c.dim(file.path) : file.path;
    const verb =
      file.action === "skipped"
        ? "unchanged"
        : options.dryRun
          ? file.action === "created" ? "would create" : "would update"
          : file.action;
    return options.verbs === false ? `    ${marker} ${path}` : `    ${marker} ${pad(path, width)}  ${c.dim(verb)}`;
  });
}

/** Numbered steps; `code` spans in a step are highlighted (and their backticks dropped when colored). */
export function steps(lines: readonly string[]): string[] {
  return lines.map((line, index) => `    ${c.dim(`${index + 1}`)}  ${colorEnabled ? line.replace(/`([^`]+)`/g, (_, code: string) => brand(code)) : line}`);
}

export function success(text: string): string {
  return `  ${c.green(sym.ok)} ${text}`;
}

export function warning(text: string): string {
  return `  ${c.yellow(sym.warn)} ${text}`;
}

export function failure(text: string, hint?: string): string {
  return `\n  ${c.red(sym.error)} ${text}${hint ? `\n    ${c.dim(hint)}` : ""}\n`;
}

/** Highlights a shell command. */
export function cmd(text: string): string {
  return brand(text);
}

export interface HelpSpec {
  title: string;
  version: string;
  description: string;
  usage: readonly string[];
  commands?: readonly (readonly [string, string])[];
  options: readonly (readonly [string, string])[];
  examples?: readonly string[];
}

export function formatHelp(spec: HelpSpec): string {
  const table = (rows: readonly (readonly [string, string])[]) => {
    const width = Math.max(...rows.map(([left]) => left.length));
    return rows.map(([left, right]) => `    ${pad(left, width)}   ${c.dim(right)}`);
  };
  const out = [intro(spec.title, spec.version), `  ${spec.description}`, heading("Usage"), ...spec.usage.map((u) => `    ${c.dim("$")} ${u}`)];
  if (spec.commands?.length) out.push(heading("Commands"), ...table(spec.commands));
  out.push(heading("Options"), ...table(spec.options));
  if (spec.examples?.length) out.push(heading("Examples"), ...spec.examples.map((e) => `    ${c.dim("$")} ${e}`));
  return `${out.join("\n")}\n`;
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------------------------
// Interactive prompts
// ---------------------------------------------------------------------------------------------

export class CancelledError extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "CancelledError";
  }
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

const out = (text: string) => process.stdout.write(text);
const HIDE_CURSOR = "\u001B[?25l";
const SHOW_CURSOR = "\u001B[?25h";
const clearLines = (count: number) => {
  for (let i = 0; i < count; i++) out("\u001B[1A\u001B[2K");
  out("\r");
};

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/**
 * Arrow-key single select. Renders the list under the question, then collapses to one `answer()`
 * line once chosen. Esc / Ctrl+C reject with `CancelledError`.
 */
export function select<T extends string>(options: {
  label: string;
  message: string;
  choices: readonly SelectOption<T>[];
  initial?: T;
}): Promise<T> {
  const { choices } = options;
  let index = Math.max(0, choices.findIndex((choice) => choice.value === options.initial));
  const render = () => {
    const lines = [`  ${brand(sym.mark)} ${c.bold(options.message)}`];
    choices.forEach((choice, i) => {
      const active = i === index;
      const radio = active ? brand(sym.radioOn) : c.dim(sym.radioOff);
      const label = active ? choice.label : c.dim(choice.label);
      lines.push(`  ${c.gray(sym.bar)}  ${radio} ${label}${choice.hint && active ? `  ${c.dim(choice.hint)}` : ""}`);
    });
    lines.push(`  ${c.gray(sym.bar)}  ${c.dim("↑/↓ to move · enter to select")}`);
    return lines;
  };

  return new Promise<T>((resolve, reject) => {
    const stdin = process.stdin;
    emitKeypressEvents(stdin);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    out(HIDE_CURSOR);
    let drawn = render();
    out(`${drawn.join("\n")}\n`);

    const redraw = () => {
      clearLines(drawn.length);
      drawn = render();
      out(`${drawn.join("\n")}\n`);
    };
    const finish = (error: Error | null) => {
      stdin.off("keypress", onKey);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      clearLines(drawn.length);
      out(SHOW_CURSOR);
      if (error) {
        out(`  ${c.red(sym.error)} ${c.dim(options.message)}\n`);
        reject(error);
      } else {
        const choice = choices[index]!;
        out(`${answer(options.label, choice.label)}\n`);
        resolve(choice.value);
      }
    };
    const onKey = (_: string, key: { name?: string; ctrl?: boolean } = {}) => {
      if ((key.ctrl && key.name === "c") || key.name === "escape") return finish(new CancelledError());
      if (key.name === "up" || key.name === "k") index = (index - 1 + choices.length) % choices.length;
      else if (key.name === "down" || key.name === "j" || key.name === "tab") index = (index + 1) % choices.length;
      else if (key.name === "return" || key.name === "enter") return finish(null);
      else return;
      redraw();
    };
    stdin.on("keypress", onKey);
  });
}

/** Single-line text input with a dimmed default. Empty input returns the default. */
export function text(options: { label: string; message: string; defaultValue: string; validate?: (value: string) => string | undefined }): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const stdin = process.stdin;
    emitKeypressEvents(stdin);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    let value = "";
    let error: string | undefined;
    let drawnLines = 0;

    const draw = () => {
      if (drawnLines) clearLines(drawnLines);
      const input = value ? value : c.dim(options.defaultValue);
      const lines = [`  ${brand(sym.mark)} ${c.bold(options.message)}`, `  ${c.gray(sym.bar)}  ${input}${colorEnabled ? "\u001B[7m \u001B[27m" : "_"}`];
      if (error) lines.push(`  ${c.gray(sym.bar)}  ${c.yellow(error)}`);
      out(`${lines.join("\n")}\n`);
      drawnLines = lines.length;
    };
    const finish = (failure: Error | null) => {
      stdin.off("keypress", onKey);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      clearLines(drawnLines);
      if (failure) {
        out(`  ${c.red(sym.error)} ${c.dim(options.message)}\n`);
        reject(failure);
      } else {
        const result = value.trim() || options.defaultValue;
        out(`${answer(options.label, result)}\n`);
        resolve(result);
      }
    };
    const onKey = (str: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean } = {}) => {
      if ((key.ctrl && key.name === "c") || key.name === "escape") return finish(new CancelledError());
      if (key.name === "return" || key.name === "enter") {
        error = options.validate?.(value.trim() || options.defaultValue);
        if (!error) return finish(null);
      } else if (key.name === "backspace") value = value.slice(0, -1);
      else if (key.ctrl && key.name === "u") value = "";
      else if (str && !key.ctrl && !key.meta && str >= " ") {
        value += str;
        error = undefined;
      }
      draw();
    };
    draw();
    stdin.on("keypress", onKey);
  });
}

// ---------------------------------------------------------------------------------------------
// Spinner + task runner
// ---------------------------------------------------------------------------------------------

const FRAMES = unicode ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] : ["-", "\\", "|", "/"];

export interface Spinner {
  stop(result: "ok" | "fail", message: string): void;
}

export function spinner(message: string): Spinner {
  if (!process.stdout.isTTY) {
    out(`  ${c.dim("…")} ${message}\n`);
    return {
      stop: (result, final) => out(`${result === "ok" ? success(final) : `  ${c.red(sym.error)} ${final}`}\n`),
    };
  }
  let frame = 0;
  const started = Date.now();
  out(HIDE_CURSOR);
  const tick = () => {
    const elapsed = Math.floor((Date.now() - started) / 1000);
    out(`\r\u001B[2K  ${brand(FRAMES[frame++ % FRAMES.length]!)} ${message}${elapsed >= 2 ? c.dim(`  ${elapsed}s`) : ""}`);
  };
  tick();
  const timer = setInterval(tick, 80);
  return {
    stop(result, final) {
      clearInterval(timer);
      out(`\r\u001B[2K${result === "ok" ? success(final) : `  ${c.red(sym.error)} ${final}`}\n${SHOW_CURSOR}`);
    },
  };
}

export interface TaskResult {
  ok: boolean;
  output: string;
  ms: number;
}

/** Runs a command with captured output behind a spinner; the output is only shown if it fails. */
export function runTask(command: string, args: readonly string[], options: { cwd: string; message: string; done: (ms: number) => string; failed: string }): Promise<TaskResult> {
  const spin = spinner(options.message);
  const started = Date.now();
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const settle = (ok: boolean, extra = "") => {
      if (settled) return;
      settled = true;
      const ms = Date.now() - started;
      output += extra;
      spin.stop(ok ? "ok" : "fail", ok ? options.done(ms) : options.failed);
      if (!ok && output.trim()) {
        const tail = output.trim().split(/\r?\n/).slice(-15);
        process.stderr.write(`${tail.map((line) => `    ${c.dim(line)}`).join("\n")}\n`);
      }
      resolve({ ok, output, ms });
    };
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: { ...process.env, npm_config_fund: "false", npm_config_audit: "false", npm_config_update_notifier: "false" },
    });
    child.stdout?.on("data", (chunk) => (output += chunk));
    child.stderr?.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => settle(false, `\n${error.message}`));
    child.on("close", (code) => settle(code === 0));
  });
}
