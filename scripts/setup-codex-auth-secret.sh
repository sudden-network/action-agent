#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

SECRET_NAME="CODEX_AUTH_JSON"
MENU_WINDOW_SIZE=10
BOOTSTRAP_URL="https://raw.githubusercontent.com/sudden-network/agent/main/scripts/bootstrap-codex-auth.sh"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOOTSTRAP_SCRIPT="$SCRIPT_DIR/bootstrap-codex-auth.sh"
AUTH_DIR=""
MENU_ANSI="false"
MENU_COLUMNS=80
MENU_KEY=""
MENU_ROWS=24
MENU_SELECTED=()
SELECTED=""
SELECTED_VALUES=()
TARGET_LABEL=""
REPLACES_EXISTING="false"
SECRET_ARGS=()

die() {
  echo "Error: $*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$AUTH_DIR" && -d "$AUTH_DIR" ]]; then
    rm -rf -- "$AUTH_DIR"
  fi
}
trap cleanup EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

read_menu_key() {
  local key
  local sequence

  MENU_KEY=""
  if ! IFS= read -r -s -n 1 key; then
    return 1
  fi
  if [[ "$key" == $'\033' ]]; then
    if IFS= read -r -s -n 2 -t 1 sequence; then
      MENU_KEY="${key}${sequence}"
    else
      MENU_KEY="$key"
    fi
  else
    MENU_KEY="$key"
  fi
}

configure_menu_terminal() {
  local terminal_size
  local rows
  local columns

  MENU_ANSI="false"
  MENU_COLUMNS=80
  MENU_ROWS=24
  if [[ -t 0 && -t 2 && "${TERM:-dumb}" != "dumb" ]]; then
    MENU_ANSI="true"
    if terminal_size="$(stty size <&0 2>/dev/null)"; then
      rows="${terminal_size%% *}"
      columns="${terminal_size##* }"
      if [[ "$rows" =~ ^[0-9]+$ && "$columns" =~ ^[0-9]+$ ]] && \
        ((rows > 0 && columns > 0)); then
        MENU_ROWS="$rows"
        MENU_COLUMNS="$columns"
      fi
    fi
  fi
}

print_menu_line() {
  local line="$1"
  local maximum_width

  if [[ "$MENU_ANSI" == "true" ]]; then
    maximum_width=$((MENU_COLUMNS - 1))
    [[ "$maximum_width" -gt 0 ]] || maximum_width=1
    if [[ "${#line}" -gt "$maximum_width" ]]; then
      if [[ "$maximum_width" -gt 3 ]]; then
        line="${line:0:$((maximum_width - 3))}..."
      else
        line="${line:0:$maximum_width}"
      fi
    fi
    printf '\r\033[2K%s\n' "$line" >&2
  else
    printf '%s\n' "$line" >&2
  fi
}

render_menu() {
  local mode="$1"
  local cursor="$2"
  local window_start="$3"
  local window_size="$4"
  local selected_count="$5"
  shift 5
  local options=("$@")
  local index
  local marker
  local checkbox
  local line

  for ((index = window_start; index < window_start + window_size; index++)); do
    marker=" "
    [[ "$index" -ne "$cursor" ]] || marker=">"
    if [[ "$mode" == "multiple" ]]; then
      checkbox=" "
      [[ "${MENU_SELECTED[$index]}" != "true" ]] || checkbox="x"
      line="$marker [$checkbox] ${options[$index]}"
    else
      line="$marker ${options[$index]}"
    fi
    print_menu_line "$line"
  done

  if [[ "$mode" == "multiple" ]]; then
    line="  Selected: $selected_count | $((cursor + 1))/${#options[@]}"
  else
    line="  $((cursor + 1))/${#options[@]}"
  fi
  print_menu_line "$line"
}

redraw_menu() {
  local line_count="$1"
  shift

  [[ "$MENU_ANSI" == "true" ]] || return 0
  printf '\033[%dA' "$line_count" >&2
  render_menu "$@"
}

choose() {
  local prompt="$1"
  shift
  local options=("$@")
  local cursor=0
  local window_start=0
  local window_size="${#options[@]}"
  local maximum_window_size
  local line_count

  [[ "${#options[@]}" -gt 0 ]] || die "No choices are available."
  configure_menu_terminal
  maximum_window_size="${#options[@]}"
  if [[ "$MENU_ANSI" == "true" ]]; then
    maximum_window_size="$MENU_WINDOW_SIZE"
    if [[ "$MENU_ROWS" -le $((MENU_WINDOW_SIZE + 5)) ]]; then
      maximum_window_size=$((MENU_ROWS - 5))
      [[ "$maximum_window_size" -gt 0 ]] || maximum_window_size=1
    fi
  fi
  if [[ "$window_size" -gt "$maximum_window_size" ]]; then
    window_size="$maximum_window_size"
  fi
  line_count=$((window_size + 1))

  echo >&2
  echo "$prompt" >&2
  echo "Use Up/Down arrows to move, Enter to choose, or q to cancel." >&2
  render_menu "single" "$cursor" "$window_start" "$window_size" 0 "${options[@]}"

  while true; do
    read_menu_key || die "Input closed."
    case "$MENU_KEY" in
      $'\033[A'|$'\033OA')
        if [[ "$cursor" -eq 0 ]]; then
          cursor=$((${#options[@]} - 1))
        else
          cursor=$((cursor - 1))
        fi
        ;;
      $'\033[B'|$'\033OB')
        cursor=$(((cursor + 1) % ${#options[@]}))
        ;;
      ""|$'\r')
        SELECTED="${options[$cursor]}"
        return
        ;;
      q|Q)
        echo "Cancelled." >&2
        exit 0
        ;;
      *) continue ;;
    esac

    if [[ "$cursor" -lt "$window_start" ]]; then
      window_start="$cursor"
    elif [[ "$cursor" -ge $((window_start + window_size)) ]]; then
      window_start=$((cursor - window_size + 1))
    fi
    redraw_menu "$line_count" "single" "$cursor" "$window_start" "$window_size" 0 "${options[@]}"
  done
}

choose_multiple() {
  local prompt="$1"
  shift
  local options=("$@")
  local cursor=0
  local window_start=0
  local window_size="${#options[@]}"
  local maximum_window_size
  local selected_count=0
  local line_count
  local i

  [[ "${#options[@]}" -gt 0 ]] || die "No choices are available."
  configure_menu_terminal
  maximum_window_size="${#options[@]}"
  if [[ "$MENU_ANSI" == "true" ]]; then
    maximum_window_size="$MENU_WINDOW_SIZE"
    if [[ "$MENU_ROWS" -le $((MENU_WINDOW_SIZE + 5)) ]]; then
      maximum_window_size=$((MENU_ROWS - 5))
      [[ "$maximum_window_size" -gt 0 ]] || maximum_window_size=1
    fi
  fi
  if [[ "$window_size" -gt "$maximum_window_size" ]]; then
    window_size="$maximum_window_size"
  fi
  line_count=$((window_size + 1))
  MENU_SELECTED=()
  for ((i = 0; i < ${#options[@]}; i++)); do
    MENU_SELECTED+=("false")
  done

  echo >&2
  echo "$prompt" >&2
  echo "Use Up/Down arrows to move, Enter to choose one, Space to select multiple, or q to cancel." >&2
  render_menu "multiple" "$cursor" "$window_start" "$window_size" "$selected_count" "${options[@]}"

  while true; do
    read_menu_key || die "Input closed."
    case "$MENU_KEY" in
      $'\033[A'|$'\033OA')
        if [[ "$cursor" -eq 0 ]]; then
          cursor=$((${#options[@]} - 1))
        else
          cursor=$((cursor - 1))
        fi
        ;;
      $'\033[B'|$'\033OB')
        cursor=$(((cursor + 1) % ${#options[@]}))
        ;;
      " ")
        if [[ "${MENU_SELECTED[$cursor]}" == "true" ]]; then
          MENU_SELECTED[$cursor]="false"
          selected_count=$((selected_count - 1))
        else
          MENU_SELECTED[$cursor]="true"
          selected_count=$((selected_count + 1))
        fi
        ;;
      ""|$'\r')
        if [[ "$selected_count" -eq 0 ]]; then
          MENU_SELECTED[$cursor]="true"
          selected_count=1
          redraw_menu "$line_count" "multiple" "$cursor" "$window_start" "$window_size" \
            "$selected_count" "${options[@]}"
        fi
        SELECTED_VALUES=()
        for ((i = 0; i < ${#options[@]}; i++)); do
          if [[ "${MENU_SELECTED[$i]}" == "true" ]]; then
            SELECTED_VALUES+=("${options[$i]}")
          fi
        done
        return
        ;;
      q|Q)
        echo "Cancelled." >&2
        exit 0
        ;;
      *) continue ;;
    esac

    if [[ "$cursor" -lt "$window_start" ]]; then
      window_start="$cursor"
    elif [[ "$cursor" -ge $((window_start + window_size)) ]]; then
      window_start=$((cursor - window_size + 1))
    fi
    redraw_menu "$line_count" "multiple" "$cursor" "$window_start" "$window_size" \
      "$selected_count" "${options[@]}"
  done
}

secret_exists() {
  local output

  if ! output="$(gh secret list --app actions "$@" --json name \
    --jq ".[] | select(.name == \"${SECRET_NAME}\") | .name")"; then
    die "Could not inspect GitHub Actions secrets. Reauthenticate with gh, then rerun."
  fi

  [[ -n "$output" ]]
}

print_local_mac_command() {
  local argument
  local quoted_argument

  echo >&2
  echo "Run this command on your local Mac:" >&2
  echo >&2
  printf "bash -o pipefail -c 'curl -fsSL %s | bash && pbpaste | gh secret set %s --app actions \"\$@\" && pbcopy </dev/null' _" \
    "$BOOTSTRAP_URL" "$SECRET_NAME" >&2
  for argument in "${SECRET_ARGS[@]}"; do
    printf -v quoted_argument '%q' "$argument"
    printf ' %s' "$quoted_argument" >&2
  done
  echo >&2
  echo >&2
  echo "Use a trusted Mac with Node.js and an authenticated GitHub CLI." >&2
  if [[ "${SECRET_ARGS[0]}" == "--org" ]]; then
    echo "For a GitHub CLI OAuth login, add the admin:org scope." >&2
  fi
  echo "The command creates a fresh login, uploads it to the selected secret, and clears the clipboard after success." >&2
}

select_repository_target() {
  local viewer="$1"
  local organizations_output
  local repositories_output
  local organization
  local repository
  local owners=("$viewer")
  local repositories=()

  if ! organizations_output="$(gh org list --limit 1000)"; then
    die "Could not list your GitHub organizations. Reauthenticate with gh, then rerun."
  fi

  while IFS= read -r organization; do
    [[ -n "$organization" ]] && owners+=("$organization")
  done <<< "$organizations_output"

  choose "Choose the repository owner ($viewer is your personal account)." "${owners[@]}"

  if ! repositories_output="$(gh repo list "$SELECTED" --limit 1000 --no-archived \
    --json nameWithOwner,viewerPermission \
    --jq 'map(select(.viewerPermission == "ADMIN")) | sort_by(.nameWithOwner)[] | .nameWithOwner')"; then
    die "Could not list repositories for $SELECTED. Reauthenticate with gh, then rerun."
  fi

  while IFS= read -r repository; do
    [[ -n "$repository" ]] && repositories+=("$repository")
  done <<< "$repositories_output"

  [[ "${#repositories[@]}" -gt 0 ]] || die "No repositories with admin access found for $SELECTED."
  choose "Choose a repository where you have admin access." "${repositories[@]}"
  repository="$SELECTED"

  if secret_exists --repo "$repository"; then
    REPLACES_EXISTING="true"
  fi
  TARGET_LABEL="repository $repository"
  SECRET_ARGS=(--repo "$repository")
}

select_organization_target() {
  local organizations_output
  local existing_visibility
  local repositories_output
  local organization
  local repository
  local visibility
  local selected_repositories=""
  local selected_labels=""
  local organizations=()
  local repositories=()

  if ! organizations_output="$(gh api --paginate user/memberships/orgs \
    --jq '.[] | select(.state == "active" and .role == "admin") | .organization.login')"; then
    die "Could not list organizations you administer. Run 'gh auth refresh --scopes admin:org', then rerun."
  fi

  while IFS= read -r organization; do
    [[ -n "$organization" ]] && organizations+=("$organization")
  done <<< "$organizations_output"

  [[ "${#organizations[@]}" -gt 0 ]] || die "No organizations with owner access found."
  choose "Choose an organization where you are an owner." "${organizations[@]}"
  organization="$SELECTED"

  if ! existing_visibility="$(gh secret list --app actions --org "$organization" \
    --json name,visibility \
    --jq ".[] | select(.name == \"${SECRET_NAME}\") | .visibility")"; then
    die "Could not inspect Actions secrets for $organization. Run 'gh auth refresh --scopes admin:org', then rerun."
  fi

  if [[ -n "$existing_visibility" ]]; then
    case "$existing_visibility" in
      all|private|selected) ;;
      *) die "Unexpected visibility for the $organization organization secret: $existing_visibility" ;;
    esac
    REPLACES_EXISTING="true"
    echo "Current ${SECRET_NAME} visibility: $existing_visibility." >&2
  fi

  choose "Choose the organization secret visibility." \
    "Selected repositories (recommended)" \
    "Private repositories" \
    "All repositories"

  case "$SELECTED" in
    "Selected repositories (recommended)") visibility="selected" ;;
    "Private repositories") visibility="private" ;;
    "All repositories") visibility="all" ;;
  esac

  if [[ "$visibility" == "selected" ]]; then
    if ! repositories_output="$(gh repo list "$organization" --limit 1000 --no-archived \
      --json nameWithOwner,viewerPermission \
      --jq 'map(select(.viewerPermission == "ADMIN")) | sort_by(.nameWithOwner)[] | .nameWithOwner')"; then
      die "Could not list repositories for $organization. Reauthenticate with gh, then rerun."
    fi

    while IFS= read -r repository; do
      [[ -n "$repository" ]] && repositories+=("$repository")
    done <<< "$repositories_output"

    [[ "${#repositories[@]}" -gt 0 ]] || die "No repositories with admin access found for $organization."
    choose_multiple "Choose repositories that can use this organization secret." "${repositories[@]}"

    for repository in "${SELECTED_VALUES[@]}"; do
      if secret_exists --repo "$repository"; then
        die "$repository already has ${SECRET_NAME}. Remove that repository secret before using the organization secret there."
      fi
      if [[ -n "$selected_repositories" ]]; then
        selected_repositories="${selected_repositories},"
        selected_labels="${selected_labels}, "
      fi
      selected_repositories="${selected_repositories}${repository#*/}"
      selected_labels="${selected_labels}${repository}"
    done

    TARGET_LABEL="organization $organization (selected repositories: $selected_labels)"
    SECRET_ARGS=(--org "$organization" --visibility selected --repos "$selected_repositories")
  else
    TARGET_LABEL="organization $organization ($visibility repositories)"
    SECRET_ARGS=(--org "$organization" --visibility "$visibility")
  fi
}

main() {
  local viewer
  local confirmation

  require_command gh

  if ! viewer="$(gh api user --jq '.login')"; then
    die "GitHub CLI authentication failed. Run 'gh auth login', then rerun."
  fi
  [[ -n "$viewer" ]] || die "GitHub CLI did not return an authenticated user."

  echo "Authenticated to GitHub as $viewer."
  choose "Where should ${SECRET_NAME} be stored?" \
    "Repository Actions secret" \
    "Organization Actions secret"

  if [[ "$SELECTED" == "Repository Actions secret" ]]; then
    select_repository_target "$viewer"
  else
    select_organization_target
  fi

  echo >&2
  echo "Target: $TARGET_LABEL" >&2
  if [[ "$REPLACES_EXISTING" == "true" ]]; then
    if [[ "${SECRET_ARGS[0]}" == "--org" ]]; then
      echo "This replaces the existing ${SECRET_NAME} value and organization access configuration." >&2
    else
      echo "This replaces the existing ${SECRET_NAME} value." >&2
    fi
  else
    echo "This creates ${SECRET_NAME}." >&2
  fi
  if [[ "${SECRET_ARGS[0]}" == "--org" ]]; then
    echo "A repository secret with the same name takes precedence over this organization secret." >&2
  fi

  choose "On a remote machine?" \
    "No, continue on this machine" \
    "Yes, show a command for my local Mac"
  if [[ "$SELECTED" == "Yes, show a command for my local Mac" ]]; then
    print_local_mac_command
    exit 0
  fi

  require_command npx
  [[ -x "$BOOTSTRAP_SCRIPT" ]] || die "Bootstrap script not found: $BOOTSTRAP_SCRIPT"

  printf 'Open the Codex login and continue? [y/N] ' >&2
  IFS= read -r confirmation || die "Input closed."
  case "$confirmation" in
    y|Y|yes|Yes|YES) ;;
    *)
      echo "Cancelled." >&2
      exit 0
      ;;
  esac

  AUTH_DIR="$(mktemp -d)"
  "$BOOTSTRAP_SCRIPT" --output "$AUTH_DIR/auth.json"
  gh secret set "$SECRET_NAME" --app actions "${SECRET_ARGS[@]}" < "$AUTH_DIR/auth.json"

  echo "Set ${SECRET_NAME} for $TARGET_LABEL."
  echo "This login is dedicated to that secret. Do not reuse it for another repo or org secret."
}

main "$@"
