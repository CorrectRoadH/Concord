#!/bin/sh
# @concord-file
# @concord-implements docs/feature/cross-platform-release/use-case/install-with-script.md
# @concord-implements docs/feature/cross-platform-release/use-case/install-with-script.md#run
set -eu

fail() { printf '%s\n' "Concord installation failed: $*" >&2; exit 1; }
supported='Supported platforms: Linux x64 (glibc >= 2.39) and Apple Silicon macOS >= 15. Try Homebrew or Nix for other installation methods.'
case "$(uname -s)/$(uname -m)" in
  Linux/x86_64)
    platform=linux-x64
    libc=$(ldd --version 2>&1) || fail "$supported glibc is required."
    printf '%s\n' "$libc" | grep -Eiq 'glibc|GNU libc|GNU C Library' || fail "$supported glibc is required."
    libc_version=$(printf '%s\n' "$libc" | head -n 1 | sed 's/.* //')
    major=${libc_version%%.*}; minor=${libc_version#*.}; minor=${minor%%.*}
    case "$major:$minor" in *[!0-9:]*|:*) fail "$supported" ;; esac
    [ "$major" -gt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -ge 39 ]; } || fail "$supported"
    ;;
  Darwin/arm64)
    platform=darwin-arm64
    macos=$(sw_vers -productVersion); major=${macos%%.*}
    case "$major" in ''|*[!0-9]*) fail "$supported" ;; esac
    [ "$major" -ge 15 ] || fail "$supported"
    ;;
  *) fail "$supported" ;;
esac
command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1 || fail 'Git is required. Install it from https://git-scm.com/downloads and retry.'
for tool in curl tar mktemp; do command -v "$tool" >/dev/null 2>&1 || fail "$tool is required."; done
if command -v sha256sum >/dev/null 2>&1; then hash_tool=sha256sum
elif command -v shasum >/dev/null 2>&1; then hash_tool=shasum
else fail 'sha256sum or shasum is required.'; fi

scratch=$(mktemp -d "${TMPDIR:-/tmp}/concord-download.XXXXXX")
staging=
new_version=
link_temp=
switching_link=false
install_lock=
reclaim_dir=
reclaim_source=
cleanup() {
  trap '' 1 2 3 15
  rm -rf "$scratch" || :
  if [ -n "$staging" ]; then rm -rf "$staging" || :; fi
  if [ -n "$link_temp" ]; then
    # A signal can arrive after mv commits the link and before the shell resumes.
    if [ "$switching_link" = true ] && [ ! -L "$link_temp" ] &&
       [ "$(readlink "$bin_dir/concord" 2>/dev/null || :)" = "$root/$version/bin/concord" ]; then
      new_version=
      touch "$root/$version/.activated" || :
    fi
    rm -f "$link_temp" || :
  fi
  if [ -n "$new_version" ]; then rm -rf "$new_version" || :; fi
  if [ -n "$reclaim_dir" ] && [ -d "$reclaim_dir" ]; then
    if [ -z "$reclaim_source" ]; then rm -rf "$reclaim_dir" || :
    elif [ ! -e "$reclaim_source" ]; then mv "$reclaim_dir" "$reclaim_source" || :
    else rmdir "$reclaim_dir" || :; fi
  fi
  if [ -n "$install_lock" ]; then rmdir "$install_lock" || :; fi
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
case "$version" in ''|*[!0-9A-Za-z.-]*) fail 'Invalid CONCORD_VERSION; use a release version such as 0.9.0.' ;; esac
printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' || fail 'Invalid CONCORD_VERSION; use a release version such as 0.9.0.'
archive="concord-$version-$platform.tar.gz"
printf 'Installing Concord %s for %s...\n' "$version" "$platform"
if ! curl -fsSL "$release/download/$tag/SHA256SUMS" -o "$scratch/SHA256SUMS"; then
  [ "$tag" = "v$version" ] || fail 'Could not download release checksums.'
  tag="concord-v$version"
  curl -fsSL "$release/download/$tag/SHA256SUMS" -o "$scratch/SHA256SUMS" || fail 'Could not download release checksums.'
fi
curl -fsSL "$release/download/$tag/$archive" -o "$scratch/$archive" || fail 'Could not download the release archive.'
expected=$(awk -v name="$archive" '
  { hash=$1; file=$2; sub(/^\*/, "", file); sub(/^.*\//, "", file);
    if (file == name && length(hash) == 64 && hash !~ /[^a-fA-F0-9]/) { count++; value=tolower(hash) } }
  END { if (count != 1) exit 1; print value }
' "$scratch/SHA256SUMS") || fail 'Missing or ambiguous archive checksum.'
if [ "$hash_tool" = sha256sum ]; then actual=$(sha256sum "$scratch/$archive")
else actual=$(shasum -a 256 "$scratch/$archive"); fi
actual=${actual%% *}
[ "$actual" = "$expected" ] || fail 'Archive checksum mismatch.'

root="$HOME/.local/share/concord"
bin_dir=${CONCORD_INSTALL_DIR:-"$HOME/.local/bin"}
mkdir -p "$root"
# Defer signals until the script knows whether it owns the new lock.
lock_interrupted=false
trap 'lock_interrupted=true' 1 2 3 15
if (trap '' 1 2 3 15; mkdir "$root/.install-lock"); then
  install_lock="$root/.install-lock"
else
  fail "Could not acquire installation lock at $root/.install-lock. Remove it only after confirming no installation is running, then retry."
fi
trap 'exit 1' 1 2 3 15
[ "$lock_interrupted" = false ] || exit 1
if [ -e "$root/$version" ] || [ -L "$root/$version" ]; then
  [ ! -L "$root/$version" ] && [ -f "$root/$version/.archive-sha256" ] && [ "$(cat "$root/$version/.archive-sha256")" = "$expected" ] && [ -x "$root/$version/bin/concord" ] || fail "Existing version has a different or missing archive checksum; delete $root/$version and retry."
else
  staging=$(mktemp -d "$root/.install.XXXXXX")
  tar -xzf "$scratch/$archive" -C "$staging" || fail 'Could not extract the release archive.'
  [ -x "$staging/bin/concord" ] && [ -d "$staging/app" ] || fail 'The release archive is incomplete.'
  printf '%s\n' "$expected" > "$staging/.archive-sha256"
  new_version="$root/$version"
  mv "$staging" "$new_version"
  staging=
fi
mkdir -p "$bin_dir"
link_temp="$bin_dir/.concord-install-$$"
ln -s "$root/$version/bin/concord" "$link_temp"
# Both forms rename the link itself, without following a directory symlink.
[ -L "$bin_dir/concord" ] || [ ! -d "$bin_dir/concord" ] || fail 'Could not switch the Concord link.'
switching_link=true
case "$platform" in
  linux-x64) mv -fT "$link_temp" "$bin_dir/concord" ;;
  darwin-arm64) mv -fh "$link_temp" "$bin_dir/concord" ;;
esac || fail 'Could not switch the Concord link.'
new_version=
touch "$root/$version/.activated"
link_temp=
# Only successfully activated versions participate in retention. Live markers
# protect an installation without probing sockets or signalling its services.
installation_in_use() {
  in_use=false
  for marker in "$1"/.in-use/*; do
    [ -f "$marker" ] || continue
    pid=${marker##*/}
    case "$pid" in ''|0|*[!0-9]*) continue ;; esac
    if kill -0 "$pid" 2>/dev/null; then in_use=true
    else rm -f "$marker"; fi
  done
  [ "$in_use" = true ]
}
retention_warning() { printf '%s\n' 'Concord is installed, but old version cleanup failed.' >&2; }
keep=0
ls -td "$root"/*/.activated > "$scratch/activations" 2>/dev/null || :
while IFS= read -r activation; do
  directory=${activation%/.activated}
  activation=${directory##*/}
  printf '%s\n' "$activation" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' || continue
  directory="$root/$activation"
  [ "$activation" != "$version" ] && [ ! -L "$directory" ] || continue
  if installation_in_use "$directory"; then continue; fi
  keep=$((keep + 1))
  [ "$keep" -gt 2 ] || continue
  # Hide the version before checking again so a new service cannot register
  # there between the final marker check and removal.
  reclaim_source="$directory"
  reclaim_dir=$(mktemp -d "$root/.reclaim.XXXXXX") || { retention_warning; break; }
  rmdir "$reclaim_dir" && mv "$reclaim_source" "$reclaim_dir" || { retention_warning; break; }
  if installation_in_use "$reclaim_dir"; then
    mv "$reclaim_dir" "$reclaim_source" || { retention_warning; break; }
  else
    reclaim_source=
    rm -rf "$reclaim_dir" || { retention_warning; break; }
  fi
  reclaim_dir=
  reclaim_source=
done < "$scratch/activations"
printf 'Concord is installed: %s/concord\nRun: concord --help\n' "$bin_dir"
case ":${PATH:-}:" in *":$bin_dir:"*) ;; *) printf 'Add %s to PATH in your shell configuration.\n' "$bin_dir" ;; esac
