import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

function resolveClaudeBin(): string {
  if (process.env.CLAUDE_CLI) return process.env.CLAUDE_CLI;
  const home = os.homedir();
  return path.join(home, ".local", "bin", "claude");
}

const CLAUDE_BIN = resolveClaudeBin();

export interface CallClaudeOptions {
  timeout?: number;
  addDirs?: string[];
  allowedTools?: string[];
}

export async function callClaude(prompt: string, options?: CallClaudeOptions): Promise<string> {
  const timeout = options?.timeout || 120_000;

  const args: string[] = [];
  if (options?.addDirs?.length) {
    args.push("--add-dir", ...options.addDirs);
  }
  if (options?.allowedTools?.length) {
    args.push("--allowedTools", options.allowedTools.join(","));
  }
  args.push("-p", prompt);

  const { stdout } = await execFileAsync(CLAUDE_BIN, args, {
    timeout,
    maxBuffer: 1024 * 1024 * 10,
  });

  return stdout.trim();
}
