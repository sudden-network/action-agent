#!/usr/bin/env bash
set -euo pipefail
umask 077

CODEX_VERSION="0.145.0"
OUTPUT_FILE=""

if [[ "$#" -ne 0 ]]; then
  if [[ "$#" -ne 2 || "$1" != "--output" ]]; then
    echo "Usage: $0 [--output PATH]" >&2
    exit 1
  fi
  OUTPUT_FILE="$2"
  if [[ -e "$OUTPUT_FILE" || -L "$OUTPUT_FILE" ]]; then
    echo "Output path already exists: $OUTPUT_FILE" >&2
    exit 1
  fi
fi

CODEX_HOME_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$CODEX_HOME_DIR"
}
trap cleanup EXIT

export CODEX_HOME="$CODEX_HOME_DIR"

cat > "$CODEX_HOME/config.toml" <<'EOF'
cli_auth_credentials_store = "file"
forced_login_method = "chatgpt"
EOF

echo "Using temporary CODEX_HOME: $CODEX_HOME"
echo "This does not touch ~/.codex/auth.json."
echo "Opening browser for Codex ChatGPT login."

npx --yes "@openai/codex@${CODEX_VERSION}" login

if [[ ! -s "$CODEX_HOME/auth.json" ]]; then
  echo "Codex login did not create auth.json." >&2
  exit 1
fi

if [[ -n "$OUTPUT_FILE" ]]; then
  cp "$CODEX_HOME/auth.json" "$OUTPUT_FILE"
  chmod 600 "$OUTPUT_FILE"
  echo "Wrote Codex auth.json to a permission-restricted file."
  exit 0
fi

pbcopy < "$CODEX_HOME/auth.json"
echo "Copied Codex auth.json to clipboard."
echo "Paste it into the CODEX_AUTH_JSON GitHub Actions secret."
echo "Run this once per repo or org secret. Do not reuse this auth.json across repos or orgs."
