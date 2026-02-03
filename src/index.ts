import core from '@actions/core';
import { bootstrapCli } from './codex';
import { postComment } from './comment';
import { readInputs } from './input';

const main = async (): Promise<void> => {
  try {
    const { cliVersion, apiKey } = readInputs();
    await bootstrapCli({ version: cliVersion, apiKey });
  } catch (error) {
    const message = `action-agent failed: ${error instanceof Error ? error.message : String(error)}`;

    core.setFailed(message);
    await postComment(message);
  }
};

void main();
