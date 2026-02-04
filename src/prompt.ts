import fs from 'fs';
import path from 'path';
import { context } from '@actions/github';
import { inputs } from './github/input';

const PROMPT_TEMPLATE = fs.readFileSync(path.join(__dirname, 'PROMPT.md'), 'utf8');

export const buildPrompt = (): string => {
  return PROMPT_TEMPLATE
    .replace('{{workflow_context}}', JSON.stringify(context))
    .replace('{{extra_prompt}}', inputs.prompt ?? '')
    .trim();
};
