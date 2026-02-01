const fs = require("fs");
const os = require("os");
const path = require("path");

const uuidRe =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const inputPath =
  process.env["INPUT_SESSIONS_DIR"] ||
  path.join(os.homedir(), ".codex", "sessions");

const outputPath = process.env.GITHUB_OUTPUT;

const writeOutput = (value) => {
  if (!outputPath) {
    return;
  }
  fs.appendFileSync(outputPath, `session_id=${value}\n`);
};

const findRolloutFiles = (root) => {
  const results = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
        let stat;
        try {
          stat = fs.statSync(fullPath);
        } catch (error) {
          continue;
        }
        results.push({ path: fullPath, mtimeMs: stat.mtimeMs });
      }
    }
  }

  return results.sort((a, b) => b.mtimeMs - a.mtimeMs);
};

const findUuid = (value) => {
  if (typeof value === "string" && uuidRe.test(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUuid(item);
      if (found) return found;
    }
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      const found = findUuid(value[key]);
      if (found) return found;
    }
  }
  return "";
};

const extractFromFile = (filePath) => {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return "";
  }

  const lines = content.split("\n").filter(Boolean);
  for (const line of lines.slice(0, 50)) {
    try {
      const parsed = JSON.parse(line);
      const found = findUuid(parsed);
      if (found) {
        return found;
      }
    } catch (error) {
      continue;
    }
  }

  return "";
};

const run = () => {
  const rolloutFiles = findRolloutFiles(inputPath);
  for (const file of rolloutFiles) {
    const found = extractFromFile(file.path);
    if (found) {
      writeOutput(found);
      return;
    }
  }
  writeOutput("");
};

run();
