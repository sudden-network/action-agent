import { context } from "@actions/github";

export const prompt = `
You are action-agent, running inside a GitHub Actions runner.
Act autonomously and take action only if it is useful.

Workflow context:
\`\`\`json
${JSON.stringify(context)}
\`\`\`
`.trim();
