import { getExecOutput } from '@actions/exec';
import type { ExecOptions } from '@actions/exec';

const buildCommandError = (
  command: string,
  args: string[],
  stdout: string,
  stderr: string,
  exitCode: number,
): string => {
  const trimmedStdout = stdout.trim();
  const trimmedStderr = stderr.trim();
  const details = [trimmedStdout, trimmedStderr].filter(Boolean).join('\n');
  const base = `Command failed: ${[command, ...args].join(' ')}`;
  return details ? `${base}\n${details}` : `${base} (exit code ${exitCode})`;
};

export const runCommand = async (command: string, args: string[], options: ExecOptions = {}): Promise<void> => {
  const result = await getExecOutput(command, args, { ...options, ignoreReturnCode: true });
  if (result.exitCode !== 0) {
    throw new Error(buildCommandError(command, args, result.stdout, result.stderr, result.exitCode));
  }
};
