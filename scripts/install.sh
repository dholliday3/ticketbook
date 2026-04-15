#!/bin/bash
#
# relay installer. Detects OS/arch, downloads the matching binary +
# SHA256 from GitHub Releases, verifies, installs to ~/.local/bin/relay,
# and optionally sparse-checks-out the `skills/` directory so agents in
# not-yet-initialized repos can still see the relay skill.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/dholliday3/relay/main/scripts/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/dholliday3/relay/main/scripts/install.sh | bash -s -- --version v0.1.0
#   bash install.sh v0.1.0
#
# The script is deliberately small — no SLSA attestation (deferred per
# PLAN-005 scope), no Windows support (deferred), no slash-command
# installation (relay's MCP tools already cover the workflow).
#
# Modeled after plannotator's install.sh but stripped to relay's
# surface area. See ~/workspace/resources/plannotator/scripts/install.sh
# for the reference implementation with Windows cleanup, Gemini/OpenCode
# integration, and SLSA verification.

set -e

REPO="dholliday3/relay"
INSTALL_DIR="$HOME/.local/bin"

VERSION="latest"
# Tracks whether a version was explicitly set via --version or positional.
# Used to reject mixing --version <tag> with a stray positional token,
# which would otherwise silently overwrite the earlier value and 404.
VERSION_EXPLICIT=0

usage() {
    cat <<'USAGE'
Usage: install.sh [--version <tag>] [--help]
       install.sh <tag>

Options:
  --version <tag>   Install a specific version (e.g. v0.1.0 or 0.1.0).
                    Defaults to the latest GitHub release.
  -h, --help        Show this help and exit.

Examples:
  curl -fsSL https://raw.githubusercontent.com/dholliday3/relay/main/scripts/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/dholliday3/relay/main/scripts/install.sh | bash -s -- --version v0.1.0
  bash install.sh v0.1.0
USAGE
}

# --- argument parsing ---------------------------------------------------

while [ $# -gt 0 ]; do
    case "$1" in
        --version)
            if [ -z "${2:-}" ]; then
                echo "--version requires an argument" >&2
                usage >&2
                exit 1
            fi
            case "$2" in
                -*)
                    echo "--version requires a tag value, got flag: $2" >&2
                    usage >&2
                    exit 1
                    ;;
            esac
            VERSION="$2"
            VERSION_EXPLICIT=1
            shift 2
            ;;
        --version=*)
            value="${1#--version=}"
            if [ -z "$value" ]; then
                echo "--version requires an argument" >&2
                usage >&2
                exit 1
            fi
            case "$value" in
                -*)
                    echo "--version requires a tag value, got flag: $value" >&2
                    usage >&2
                    exit 1
                    ;;
            esac
            VERSION="$value"
            VERSION_EXPLICIT=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        -*)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 1
            ;;
        *)
            # Positional form: install.sh v0.1.0. Reject if --version was
            # already passed — silent overwrite is worse than a clean error.
            if [ "$VERSION_EXPLICIT" -eq 1 ]; then
                echo "Unexpected positional argument: $1 (version already set)" >&2
                usage >&2
                exit 1
            fi
            VERSION="$1"
            VERSION_EXPLICIT=1
            shift
            ;;
    esac
done

# --- OS / arch detection ------------------------------------------------

case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    *)
        echo "Unsupported OS: $(uname -s)" >&2
        echo "relay currently ships binaries for macOS and Linux only." >&2
        exit 1
        ;;
esac

case "$(uname -m)" in
    x86_64|amd64)   arch="x64" ;;
    arm64|aarch64)  arch="arm64" ;;
    *)
        echo "Unsupported architecture: $(uname -m)" >&2
        exit 1
        ;;
esac

platform="${os}-${arch}"
binary_name="relay-${platform}"

# --- version resolution -------------------------------------------------

if [ "$VERSION" = "latest" ]; then
    echo "Fetching latest version from github.com/${REPO}..."
    # Extract just the `"tag_name":"vX.Y.Z"` fragment first, then cut. The
    # naive `grep '"tag_name"' | cut -d'"' -f4` breaks against GitHub's
    # single-line JSON response because the first quoted string in that
    # blob is the `url` field, not `tag_name` — cut -f4 would return the
    # URL, not the tag. `grep -o` pins the match to the tag fragment.
    latest_tag=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep -o '"tag_name":"[^"]*"' | head -1 | cut -d'"' -f4)
    if [ -z "$latest_tag" ]; then
        echo "Failed to fetch latest version from GitHub API." >&2
        echo "Pass --version <tag> explicitly if you're hitting rate limits." >&2
        exit 1
    fi
else
    # Normalize: auto-prefix `v` if missing. Users often paste just `0.1.0`.
    case "$VERSION" in
        v*) latest_tag="$VERSION" ;;
        *)  latest_tag="v$VERSION" ;;
    esac
fi

echo "Installing relay ${latest_tag} (${platform})..."

# --- download binary + checksum ----------------------------------------

binary_url="https://github.com/${REPO}/releases/download/${latest_tag}/${binary_name}"
checksum_url="${binary_url}.sha256"

mkdir -p "$INSTALL_DIR"

tmp_file=$(mktemp)
curl -fsSL -o "$tmp_file" "$binary_url"

expected_checksum=$(curl -fsSL "$checksum_url" | cut -d' ' -f1)
if [ -z "$expected_checksum" ]; then
    echo "Failed to fetch checksum from ${checksum_url}" >&2
    rm -f "$tmp_file"
    exit 1
fi

if [ "$(uname -s)" = "Darwin" ]; then
    actual_checksum=$(shasum -a 256 "$tmp_file" | cut -d' ' -f1)
else
    actual_checksum=$(sha256sum "$tmp_file" | cut -d' ' -f1)
fi

if [ "$actual_checksum" != "$expected_checksum" ]; then
    echo "Checksum verification failed!" >&2
    echo "  expected: $expected_checksum" >&2
    echo "  actual:   $actual_checksum" >&2
    rm -f "$tmp_file"
    exit 1
fi

echo "SHA256 verified."

# --- install ------------------------------------------------------------

# Remove the old binary first. On macOS you can overwrite a running
# executable via rename(), but a stale file from a failed prior install
# (e.g., non-executable, wrong owner) can still trip mv. rm first is
# strictly safer.
rm -f "$INSTALL_DIR/relay" 2>/dev/null || true

mv "$tmp_file" "$INSTALL_DIR/relay"
chmod +x "$INSTALL_DIR/relay"

echo ""
echo "relay ${latest_tag} installed to ${INSTALL_DIR}/relay"

# --- PATH warning -------------------------------------------------------

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
    echo ""
    echo "${INSTALL_DIR} is not in your PATH. Add it with:"
    echo ""

    case "$SHELL" in
        */zsh)  shell_config="~/.zshrc" ;;
        */bash) shell_config="~/.bashrc" ;;
        */fish) shell_config="~/.config/fish/config.fish" ;;
        *)      shell_config="your shell config" ;;
    esac

    echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ${shell_config}"
    echo "  source ${shell_config}"
fi

# --- global skill install via git sparse-checkout ----------------------
#
# Plannotator's trick: the binary ships without an embedded skill file, but
# install.sh does a sparse-checkout of the repo at the release tag to pull
# just `skills/` into the user's global skill directories. That way agents
# running in repos that HAVEN'T been `relay init`'d still know what
# relay is and can suggest it. For repos that HAVE been init'd, the
# project-level skill at `.claude/skills/relay/SKILL.md` takes
# precedence (Claude Code resolves project skills first).
#
# The subshell wrapping the cd-chain scopes any CWD changes to the
# subshell — if sparse-checkout fails partway, the parent script's CWD
# stays put and the subsequent `rm -rf` doesn't race against a dangling
# working directory.

if command -v git >/dev/null 2>&1; then
    CLAUDE_SKILLS_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"
    AGENTS_SKILLS_DIR="$HOME/.agents/skills"
    skills_tmp=$(mktemp -d)

    if (
        cd "$skills_tmp" &&
        git clone --depth 1 --filter=blob:none --sparse \
            "https://github.com/${REPO}.git" --branch "$latest_tag" repo 2>/dev/null &&
        cd repo &&
        git sparse-checkout set skills 2>/dev/null &&
        [ -d "skills/relay" ] &&
        [ "$(ls -A skills/relay 2>/dev/null)" ] &&
        mkdir -p "$CLAUDE_SKILLS_DIR/relay" "$AGENTS_SKILLS_DIR/relay" &&
        cp -r skills/relay/. "$CLAUDE_SKILLS_DIR/relay/" &&
        cp -r skills/relay/. "$AGENTS_SKILLS_DIR/relay/"
    ); then
        echo ""
        echo "Installed relay skill to:"
        echo "  ${CLAUDE_SKILLS_DIR}/relay/"
        echo "  ${AGENTS_SKILLS_DIR}/relay/"
    else
        echo ""
        echo "Skipping global skill install (git sparse-checkout failed or skills/relay empty)."
        echo "The per-project skill written by 'relay init' still works."
    fi

    rm -rf "$skills_tmp"
else
    echo ""
    echo "Skipping global skill install (git not found)."
    echo "The per-project skill written by 'relay init' still works."
fi

# --- next steps ---------------------------------------------------------

echo ""
echo "Next steps:"
echo "  cd <your-project>"
echo "  relay init       # scaffold .relay/, .mcp.json, skill files"
echo "  relay onboard    # add agent instructions to CLAUDE.md"
echo "  relay            # start the local UI at http://localhost:4242"
