"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const artifact_1 = require("@actions/artifact");
const exec = __importStar(require("@actions/exec"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const CODEX_VERSION = '0.93.0';
const OUTPUT_FILE = '/tmp/codex_output.txt';
const RESPONSE_FILE = '/tmp/codex_response.txt';
const ARTIFACT_RETENTION_DAYS = 7;
const readText = (filePath) => fs.readFileSync(filePath, 'utf8');
const writeText = (filePath, contents) => {
    fs.writeFileSync(filePath, contents, { encoding: 'utf8' });
};
const ensureDir = (dirPath) => {
    fs.mkdirSync(dirPath, { recursive: true });
};
const copyDir = (src, dest) => {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        }
        else if (entry.isFile()) {
            ensureDir(path.dirname(destPath));
            fs.copyFileSync(srcPath, destPath);
        }
    }
};
const listFiles = (dir) => {
    const files = [];
    const stack = [dir];
    while (stack.length) {
        const current = stack.pop();
        if (!current) {
            continue;
        }
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
            }
            else if (entry.isFile()) {
                files.push(fullPath);
            }
        }
    }
    return files;
};
const requireString = (value, label) => {
    if (typeof value !== 'string') {
        throw new Error(`${label} missing.`);
    }
    return value;
};
const readPromptTemplate = () => {
    const actionPath = process.env.GITHUB_ACTION_PATH || path.resolve(__dirname, '..');
    const templatePath = path.join(actionPath, 'src', 'prompt-template.md');
    return readText(templatePath);
};
const replaceTemplate = (template, replacements) => Object.entries(replacements).reduce((output, [key, value]) => output.split(key).join(value), template);
const isRecord = (value) => typeof value === 'object' && value !== null;
const parseJsonLine = (line) => {
    try {
        return JSON.parse(line);
    }
    catch (error) {
        throw new Error('Failed to parse Codex JSONL output.');
    }
};
const parseJsonLines = (filePath) => {
    if (!fs.existsSync(filePath)) {
        return '';
    }
    const data = readText(filePath);
    return data.split(/\r?\n/).reduce((response, line) => {
        if (!line.trim()) {
            return response;
        }
        const parsed = parseJsonLine(line);
        if (isRecord(parsed) && parsed.type === 'item.completed') {
            const item = isRecord(parsed.item) ? parsed.item : {};
            if (item.type === 'agent_message') {
                return typeof item.text === 'string' ? item.text : '';
            }
        }
        return response;
    }, '');
};
const buildEnv = (env) => {
    const output = {};
    for (const [key, value] of Object.entries(env)) {
        if (typeof value === 'string') {
            output[key] = value;
        }
    }
    return output;
};
const addEyesReaction = async ({ commentId, issueNumber, owner, repo, octokit, }) => {
    if (commentId) {
        await octokit.rest.reactions.createForIssueComment({
            owner,
            repo,
            comment_id: Number(commentId),
            content: 'eyes',
        });
        return;
    }
    await octokit.rest.reactions.createForIssue({
        owner,
        repo,
        issue_number: issueNumber,
        content: 'eyes',
    });
};
const getLatestSessionArtifact = async ({ owner, repo, issueNumber, octokit, }) => {
    const perPage = 100;
    const matches = [];
    for (let page = 1;; page += 1) {
        const artifacts = await octokit.rest.actions.listArtifactsForRepo({
            owner,
            repo,
            name: `action-agent-session-${issueNumber}`,
            per_page: perPage,
            page,
        });
        const pageArtifacts = artifacts.data.artifacts;
        matches.push(...pageArtifacts.filter((item) => !item.expired));
        if (pageArtifacts.length < perPage) {
            break;
        }
    }
    if (!matches.length) {
        throw new Error('Session artifact not found; cannot resume.');
    }
    matches.sort((a, b) => {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        return aTime - bTime;
    });
    return matches[matches.length - 1];
};
const isStaleEdit = async ({ eventAction, commentId, issueNumber, owner, repo, octokit, payload, }) => {
    if (eventAction !== 'edited') {
        return false;
    }
    if (commentId) {
        const current = await octokit.rest.issues.getComment({ owner, repo, comment_id: Number(commentId) });
        return current.data.body !== payload.comment?.body;
    }
    const issue = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber });
    return issue.data.title !== payload.issue?.title || issue.data.body !== payload.issue?.body;
};
const buildPrompt = ({ commentId, eventAction, issueNumber, issueTitle, issueBody, issueUrl, commentBody, commentUrl, }) => {
    const resumeMode = Boolean(commentId) || eventAction === 'edited';
    if (commentId) {
        const lines = [
            ...(eventAction === 'edited'
                ? [
                    `Edited comment: ${commentUrl}`,
                    'Respond to the updated content and continue the existing thread.',
                    '',
                ]
                : []),
            commentBody,
        ];
        return { promptText: lines.join('\n'), resumeMode };
    }
    const editContext = eventAction === 'edited'
        ? `Issue updated: ${issueUrl}\n\nContinue the existing thread; do not restart.\n\n`
        : '';
    const promptText = replaceTemplate(readPromptTemplate(), {
        '{{ISSUE_NUMBER}}': String(issueNumber),
        '{{ISSUE_TITLE}}': issueTitle,
        '{{ISSUE_BODY}}': issueBody,
        '{{EDIT_CONTEXT}}': editContext,
    });
    return { promptText, resumeMode };
};
const safeParseJsonLines = (filePath) => {
    try {
        return parseJsonLines(filePath);
    }
    catch (error) {
        return '';
    }
};
const main = async () => {
    let issueNumber = 0;
    let commentId = '';
    let owner = '';
    let repo = '';
    let octokit = null;
    const codexHome = path.join(process.env.RUNNER_TEMP || '/tmp', 'codex-home');
    const codexStateDir = codexHome;
    const codexSessionsPath = path.join(codexHome, 'sessions');
    ensureDir(codexHome);
    core.exportVariable('CODEX_HOME', codexHome);
    core.exportVariable('CODEX_STATE_DIR', codexStateDir);
    core.exportVariable('CODEX_SESSIONS_PATH', codexSessionsPath);
    const postErrorComment = async (message) => {
        if (!octokit || !owner || !repo || !Number.isFinite(issueNumber)) {
            return;
        }
        await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: issueNumber,
            body: message,
        });
    };
    try {
        const issueNumberInput = core.getInput('issue_number', { required: true });
        const commentIdInput = core.getInput('comment_id');
        const model = core.getInput('model');
        const reasoningEffort = core.getInput('reasoning_effort');
        const openaiApiKey = core.getInput('openai_api_key', { required: true });
        const githubToken = core.getInput('github_token', { required: true });
        issueNumber = Number(issueNumberInput);
        commentId = commentIdInput.trim();
        ({ owner, repo } = github.context.repo);
        const eventAction = github.context.payload.action;
        octokit = github.getOctokit(githubToken);
        const codexEnv = buildEnv({
            ...process.env,
            CODEX_HOME: codexHome,
            CODEX_STATE_DIR: codexStateDir,
            CODEX_SESSIONS_PATH: codexSessionsPath,
            GITHUB_TOKEN: githubToken,
            OPENAI_API_KEY: openaiApiKey,
        });
        await exec.exec('npm', ['install', '-g', `@openai/codex@${CODEX_VERSION}`]);
        if (!openaiApiKey) {
            throw new Error('OPENAI_API_KEY is missing. Add it as a repo/org secret.');
        }
        if (await isStaleEdit({
            eventAction,
            commentId,
            issueNumber,
            owner,
            repo,
            octokit,
            payload: github.context.payload,
        })) {
            return;
        }
        try {
            await addEyesReaction({ commentId, issueNumber, owner, repo, octokit });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            core.info(`Reaction failed: ${message}`);
        }
        const isFollowUp = Boolean(commentId) || eventAction === 'edited';
        if (isFollowUp) {
            const latestSessionArtifact = await getLatestSessionArtifact({
                owner,
                repo,
                issueNumber,
                octokit,
            });
            const downloadPath = path.join(process.env.RUNNER_TEMP || '/tmp', 'codex-session');
            const workflowRunId = latestSessionArtifact.workflow_run?.id;
            ensureDir(downloadPath);
            if (!workflowRunId) {
                throw new Error('Session artifact missing workflow run; cannot resume.');
            }
            try {
                await new artifact_1.DefaultArtifactClient().downloadArtifact(latestSessionArtifact.id, {
                    path: downloadPath,
                    findBy: {
                        token: githubToken,
                        repositoryOwner: owner,
                        repositoryName: repo,
                        workflowRunId,
                    },
                });
            }
            catch (error) {
                throw new Error('Session artifact not found; cannot resume.');
            }
            const source = downloadPath;
            const target = fs.existsSync(path.join(downloadPath, 'sessions'))
                ? codexStateDir
                : path.join(codexStateDir, 'sessions');
            if (!fs.existsSync(source)) {
                throw new Error('Session artifact missing contents; cannot resume.');
            }
            fs.rmSync(codexStateDir, { recursive: true, force: true });
            ensureDir(target);
            copyDir(source, target);
        }
        const issue = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber });
        const issueUrl = issue.data.html_url;
        const commentData = commentId
            ? await octokit.rest.issues.getComment({ owner, repo, comment_id: Number(commentId) })
            : null;
        const commentBody = commentData ? requireString(commentData.data.body, 'Comment body') : '';
        const commentUrl = commentData ? commentData.data.html_url : '';
        const { promptText, resumeMode } = buildPrompt({
            commentId,
            eventAction,
            issueNumber,
            issueTitle: issue.data.title,
            issueBody: issue.data.body ?? '',
            issueUrl,
            commentBody,
            commentUrl,
        });
        await exec.exec('bash', ['-lc', 'printenv OPENAI_API_KEY | codex login --with-api-key'], {
            env: codexEnv,
        });
        const outputStream = fs.createWriteStream(OUTPUT_FILE, { flags: 'w' });
        const codexExit = await exec.exec('codex', [
            ['exec'],
            ['--json'],
            ['--sandbox', 'workspace-write'],
            ['-c', 'approval_policy="never"'],
            ['-c', 'sandbox_workspace_write.network_access=true'],
            ['-c', 'shell_environment_policy.inherit=all'],
            ['-c', 'shell_environment_policy.ignore_default_excludes=true'],
            ...(model ? [['--model', model]] : []),
            ...(reasoningEffort ? [['-c', `model_reasoning_effort=${reasoningEffort}`]] : []),
            ...(resumeMode ? [['resume', '--last', '-']] : [['-']]),
        ].flat(), {
            env: codexEnv,
            input: Buffer.from(promptText, 'utf8'),
            listeners: {
                stdout: (data) => outputStream.write(data),
                stderr: (data) => outputStream.write(data),
            },
            ignoreReturnCode: true,
        });
        await new Promise((resolve) => outputStream.end(resolve));
        const responseText = safeParseJsonLines(OUTPUT_FILE);
        if (responseText) {
            writeText(RESPONSE_FILE, responseText);
        }
        else if (fs.existsSync(OUTPUT_FILE)) {
            fs.copyFileSync(OUTPUT_FILE, RESPONSE_FILE);
        }
        else {
            writeText(RESPONSE_FILE, '');
        }
        fs.rmSync(path.join(codexStateDir, 'auth.json'), { force: true });
        fs.rmSync(path.join(codexStateDir, 'tmp'), { recursive: true, force: true });
        if (codexExit === 0) {
            const files = listFiles(codexStateDir);
            if (!files.length) {
                throw new Error('No Codex state files found for upload.');
            }
            await new artifact_1.DefaultArtifactClient().uploadArtifact(`action-agent-session-${issueNumber}`, files, codexStateDir, {
                retentionDays: ARTIFACT_RETENTION_DAYS,
            });
        }
        const header = eventAction !== 'edited'
            ? ''
            : commentId
                ? `Edited comment: ${commentUrl}\n\n`
                : `Issue updated: ${issueUrl}\n\n`;
        const body = codexExit !== 0
            ? header + (fs.existsSync(OUTPUT_FILE) ? readText(OUTPUT_FILE) : '(no output)')
            : fs.existsSync(RESPONSE_FILE)
                ? header + readText(RESPONSE_FILE)
                : fs.existsSync(OUTPUT_FILE)
                    ? header + readText(OUTPUT_FILE)
                    : header + '(no output)';
        await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: issueNumber,
            body,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
            await postErrorComment(message);
        }
        catch (commentError) {
            const commentMessage = commentError instanceof Error ? commentError.message : String(commentError);
            core.info(`Failed to post error comment: ${commentMessage}`);
        }
        core.setFailed(message);
    }
};
void main();
