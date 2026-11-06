#!/bin/sh
# @concord-file
# @concord-implements docs/feature/cross-platform-release/use-case/install-with-script.md
set -eu

fail() { printf '%s\n' "Concord installation failed: $*" >&2; exit 1; }
supported='Supported platforms: Linux x64 (glibc) and Apple Silicon macOS. Try Homebrew or Nix for other installation methods.'
case "$(uname -s)/$(uname -m)" in
  Linux/x86_64)
    platform=linux-x64
    ldd --version 2>&1 | { grep -Eiq 'glibc|GNU libc|GNU C Library' || exit 1; } || fail "$supported glibc is required."
    ;;
  Darwin/arm64) platform=darwin-arm64 ;;
  *) fail "$supported" ;;
esac
command -v node >/dev/null 2>&1 || fail 'Node.js 24.15+ is required. Install it from https://nodejs.org/ and retry.'
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 24 || (major === 24 && minor >= 15) ? 0 : 1)' || fail 'Node.js 24.15+ is required. Install it from https://nodejs.org/ and retry.'
command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1 || fail 'Git is required. Install it from https://git-scm.com/downloads and retry.'
for tool in curl tar mktemp; do command -v "$tool" >/dev/null 2>&1 || fail "$tool is required."; done
if command -v sha256sum >/dev/null 2>&1; then hash_tool=sha256sum
elif command -v shasum >/dev/null 2>&1; then hash_tool=shasum
else fail 'sha256sum or shasum is required.'; fi

scratch=$(mktemp -d "${TMPDIR:-/tmp}/concord-download.XXXXXX")
staging=
new_version=
link_temp=
cleanup() {
  rm -rf "$scratch"
  if [ -n "$staging" ]; then rm -rf "$staging"; fi
  if [ -n "$link_temp" ]; then rm -f "$link_temp"; fi
  if [ -n "$new_version" ]; then rm -rf "$new_version"; fi
}
trap cleanup 0
trap 'exit 1' 1 2 3 15
release='https://github.com/CorrectRoadH/Concord/releases'
version=${CONCORD_VERSION:-}
tag="v$version"
if [ -z "$version" ]; then
  latest=$(curl -fsSL -o /dev/null -w '%{url_effective}' "$release/latest") || fail 'Could not find the latest release.'
  case "$latest" in
    "$release/tag/concord-v"*) version=${latest#"$release/tag/concord-v"}; tag="concord-v$version" ;;
    "$release/tag/v"*) version=${latest#"$release/tag/v"}; tag="v$version" ;;
    *) fail 'Invalid latest release URL.' ;;
  esac
fi
# Versions are path components, never arbitrary filesystem paths or URL fragments.
node -e 'if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(process.argv[1])) process.exit(1)' "$version" || fail 'Invalid CONCORD_VERSION; use a release version such as 0.9.0.'
archive="concord-sdlc-$version.tgz"
printf 'Installing Concord %s for %s...\n' "$version" "$platform"
if ! curl -fsSL "$release/download/$tag/SHA256SUMS" -o "$scratch/SHA256SUMS"; then
  # The release workflow also accepts the documented concord-v tag prefix.
  [ "$tag" = "v$version" ] || fail 'Could not download release checksums.'
  tag="concord-v$version"
  curl -fsSL "$release/download/$tag/SHA256SUMS" -o "$scratch/SHA256SUMS" || fail 'Could not download release checksums.'
fi
curl -fsSL "$release/download/$tag/$archive" -o "$scratch/$archive" || fail 'Could not download the release package.'
expected=$(node -e '
  const fs = require("node:fs"), path = require("node:path");
  const rows = fs.readFileSync(process.argv[1], "utf8").trim().split(/\r?\n/).map(row => /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(row)).filter(row => row && path.posix.basename(row[2]) === process.argv[2]);
  if (rows.length !== 1) process.exit(1);
  process.stdout.write(rows[0][1].toLowerCase());
' "$scratch/SHA256SUMS" "$archive") || fail 'Missing or ambiguous package checksum.'
if [ "$hash_tool" = sha256sum ]; then actual=$(sha256sum "$scratch/$archive")
else actual=$(shasum -a 256 "$scratch/$archive"); fi
actual=${actual%% *}
[ "$actual" = "$expected" ] || fail 'Package checksum mismatch.'

root="$HOME/.local/share/concord"
bin_dir=${CONCORD_INSTALL_DIR:-"$HOME/.local/bin"}
mkdir -p "$root"
staging=$(mktemp -d "$root/.install.XXXXXX")
tar -xzf "$scratch/$archive" -C "$staging" || fail 'Could not extract the release package.'
package="$staging/package"
[ -f "$package/package.json" ] || fail 'The release package has no package.json.'
package_manager=$(node -e '
  const fs = require("node:fs"), p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (p.version !== process.argv[2] || !/^pnpm@\d+\.\d+\.\d+$/.test(p.packageManager)) process.exit(1);
  process.stdout.write(p.packageManager);
' "$package/package.json" "$version") || fail 'Invalid release version or pinned pnpm packageManager.'
cli=$(node -e '
  const fs = require("node:fs"), p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const bin = p.bin && p.bin.concord;
  if (typeof bin !== "string" || bin.startsWith("/") || bin.split("/").some(part => part === "..")) process.exit(1);
  process.stdout.write(bin);
' "$package/package.json") || fail 'Invalid Concord executable.'
[ -f "$package/$cli" ] || fail 'The release package has no Concord executable.'
pnpm_version=${package_manager#pnpm@}
if command -v pnpm >/dev/null 2>&1 && [ "$(cd "$package" && pnpm --version)" = "$pnpm_version" ]; then
  (cd "$package" && pnpm install --prod --frozen-lockfile --ignore-scripts) || fail 'Frozen production dependency installation failed.'
else
  command -v npm >/dev/null 2>&1 || fail 'npm is required to run the package-pinned pnpm. Install Node.js with npm and retry.'
  (cd "$package" && npm exec --yes --package="$package_manager" -- pnpm install --prod --frozen-lockfile --ignore-scripts) || fail 'Package-pinned pnpm installation failed.'
fi
chmod +x "$package/$cli"
# An existing version is immutable. A failed candidate never replaces its bytes.
if [ ! -e "$root/$version" ]; then
  new_version="$root/$version"
  mv "$package" "$new_version"
else
  [ -f "$root/$version/$cli" ] || fail 'Existing version is incomplete; move it aside and retry.'
fi
mkdir -p "$bin_dir"
link_temp="$bin_dir/.concord-install-$$"
ln -s "$root/$version/$cli" "$link_temp"
# rename replaces a file/symlink atomically and refuses an existing directory.
node -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' "$link_temp" "$bin_dir/concord" || fail 'Could not switch the Concord link.'
link_temp=
new_version=
# Retention is based on successful installation order; unrelated entries are untouched.
node -e '
  const fs = require("node:fs"), path = require("node:path"), root = process.argv[1], current = process.argv[2];
  fs.utimesSync(path.join(root, current), new Date(), new Date());
  const versions = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(entry.name)).map(entry => ({ name: entry.name, mtime: fs.statSync(path.join(root, entry.name)).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
  const previous = versions.find(entry => entry.name !== current)?.name;
  for (const entry of versions) if (entry.name !== current && entry.name !== previous) fs.rmSync(path.join(root, entry.name), { recursive: true });
' "$root" "$version" || printf '%s\n' 'Concord is installed, but old version cleanup failed.' >&2
printf 'Concord is installed: %s/concord\nRun: concord --help\n' "$bin_dir"
case ":${PATH:-}:" in *":$bin_dir:"*) ;; *) printf 'Add %s to PATH in your shell configuration.\n' "$bin_dir" ;; esac
