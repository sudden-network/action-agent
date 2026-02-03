import exec from '@actions/exec';

const CODEX_VERSION = "0.93.0";

const install = async (version = CODEX_VERSION): Promise<void> => {
  await exec.exec('npm', ['install', '-g', `@openai/codex@${version}`]);
};

const login = async (apiKey: string): Promise<void> => {
  await exec.exec('bash', ['-lc', 'printenv OPENAI_API_KEY | codex login --with-api-key'], {
    env: { ...process.env, OPENAI_API_KEY: apiKey },
  });
};

export const bootstrapCli = async ({ version, apiKey }: { version?: string; apiKey: string }): Promise<void> => {
  await install(version);
  await login(apiKey);
};
