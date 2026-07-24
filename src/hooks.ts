import { homedir } from "node:os";
import { join } from "node:path";
import {
  computeCodexConfigUpdate as computeAxiCodexConfigUpdate,
  computeSessionStartHookUpdate,
  installSessionStartHooks,
  shouldInstallHooksForNodeAxiExecPath,
} from "axi-sdk-js";

interface HookEntry {
  type: "command";
  command: string;
  timeout?: number;
}

interface HookGroup {
  matcher: string;
  hooks: HookEntry[];
}

export interface HookSettings {
  hooks?: {
    SessionStart?: HookGroup[];
    [event: string]: HookGroup[] | undefined;
  };
  [key: string]: unknown;
}

export interface HookTarget {
  path: string;
}

const HOOK_MARKER = "chrome-devtools-axi";

/**
 * Only install hooks from packaged or installed entrypoints.
 * Development TypeScript entrypoints should not self-register.
 */
export function shouldInstallHooksForExecPath(execPath: string): boolean {
  return shouldInstallHooksForNodeAxiExecPath(execPath, {
    marker: HOOK_MARKER,
    binaryNames: [HOOK_MARKER],
    distEntrypoints: ["dist/bin/chrome-devtools-axi.js"],
  });
}

/**
 * Resolve the Claude Code config dirs whose `settings.json` should receive the
 * hook. Claude Code reads from `$CLAUDE_CONFIG_DIR` (default `~/.claude`);
 * firstmate's glm crewmates run the binary under a redirected dir, exposed as
 * `CLAUDE_CONFIG_DIR` or `FM_GLM_CLAUDE_CONFIG_DIR` (default `~/.glm`). When a
 * redirect is active we target BOTH the default and the redirected dir (deduped)
 * so a mixed claude + glm fleet stays in sync. Mirrors quota-axi's resolution
 * and the axi-sdk-js installer's behavior.
 */
export function resolveClaudeConfigDirs(home: string): string[] {
  const dirs = [join(home, ".claude")];
  const redirected =
    process.env.CLAUDE_CONFIG_DIR || process.env.FM_GLM_CLAUDE_CONFIG_DIR;
  if (redirected) {
    dirs.push(redirected);
  }
  return Array.from(new Set(dirs));
}

/**
 * Returns hook installation targets for supported agents.
 */
export function getHookTargets(): HookTarget[] {
  const home = homedir();
  return [
    ...resolveClaudeConfigDirs(home).map((path) => ({
      path: join(path, "settings.json"),
    })),
    { path: join(home, ".codex", "hooks.json") },
    { path: join(home, ".codex", "config.toml") },
  ];
}

/**
 * Pure function: compute the hook update for agent settings.
 * Works for both Claude Code (settings.json) and Codex CLI (hooks.json).
 * Returns [updatedSettings, changed].
 */
export function computeHookUpdate(
  settings: HookSettings,
  execPath: string,
): [HookSettings, boolean] {
  return computeSessionStartHookUpdate(settings, {
    marker: HOOK_MARKER,
    command: execPath,
    timeoutSeconds: 10,
  }) as [HookSettings, boolean];
}

/**
 * Pure function: ensure Codex hooks are enabled in config.toml.
 * Returns [updatedToml, changed].
 */
export function computeCodexConfigUpdate(content: string): [string, boolean] {
  return computeAxiCodexConfigUpdate(content);
}

/**
 * Idempotently install session hooks into all supported agents.
 * Silently does nothing on any error.
 */
export function installHooks(): void {
  try {
    installHooksOrThrow();
  } catch {
    // Best-effort — never fail the CLI over hook installation
  }
}

export function installHooksOrThrow(): void {
  const errors: string[] = [];
  installSessionStartHooks({
    marker: HOOK_MARKER,
    timeoutSeconds: 10,
    shouldInstall: shouldInstallHooksForExecPath,
    onError: (message) => {
      errors.push(message);
    },
  });
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}
