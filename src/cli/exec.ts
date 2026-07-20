import { spawn } from "node:child_process"

export type ExecResult = {
  /** null when the binary could not start (missing, not executable) or was killed by the timeout. */
  code: number | null
  stdout: string
  stderr: string
}

export type ExecOptions = { cwd?: string; timeoutMs?: number; env?: Record<string, string | undefined>; input?: string }

/** Runs a command without a shell. Never throws. */
export function run(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    let settled = false
    const done = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    }
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    })
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          stderr += `\nsolodev: timed out after ${opts.timeoutMs}ms`
          child.kill("SIGKILL")
          done(null)
        }, opts.timeoutMs)
      : undefined
    child.stdout?.on("data", (d) => {
      stdout += d
    })
    child.stderr?.on("data", (d) => {
      stderr += d
    })
    child.on("error", () => done(null))
    child.on("close", (code) => done(code))
    if (opts.input !== undefined) child.stdin?.end(opts.input)
  })
}

/** Runs a command line from AGENTS.md through the shell. */
export function shell(command: string, cwd: string, timeoutMs?: number): Promise<ExecResult> {
  return run("sh", ["-c", command], { cwd, timeoutMs, env: { CI: "1" } })
}

/** The last `n` non-empty lines of a command's combined output, where runners print their failures. */
export function tail(result: ExecResult, n = 15): string[] {
  const lines = `${result.stdout}\n${result.stderr}`.split("\n").filter((l) => l.trim())
  return lines.slice(-n)
}
