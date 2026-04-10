import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function callClaude(prompt: string, options?: { timeout?: number }): Promise<string> {
  const timeout = options?.timeout || 120_000;

  const { stdout } = await execFileAsync("claude", ["-p", prompt], {
    timeout,
    maxBuffer: 1024 * 1024 * 10,
  });

  return stdout.trim();
}
