#!/usr/bin/env bash
# Installs the pinned gitleaks and prints nothing but errors; the binary ends up at "$1/gitleaks".
# Usage: GITLEAKS_VERSION=x GITLEAKS_SHA256=y scripts/ci/install-gitleaks.sh <dir>
#
# <dir> is the directory the workflow caches (actions/cache). It holds the release tarball, never an
# unchecked binary: the tarball's SHA-256 is compared with the one pinned in the workflow (it is the
# line of the release's official gitleaks_<version>_checksums.txt) every time, whether the tarball
# came from the cache or from the download, and only then is the binary extracted.
#   - cached tarball whose checksum differs: discarded, downloaded again, checked again;
#   - download: curl with retries and backoff; a 504 from GitHub is retried, not skipped. If the release URL
#     still fails, the same asset is fetched from the GitHub API (GITLEAKS_ASSET_ID, pinned in the workflow;
#     GITHUB_TOKEN, when set, is sent to api.github.com only: curl drops it on the redirect to another host);
#     the checksum is verified whatever the source;
#   - any failure exits non-zero. The secret scan is never skipped: a missing or unverified scanner fails the gate.
set -euo pipefail

dir=${1:?usage: install-gitleaks.sh <dir>}
: "${GITLEAKS_VERSION:?}" "${GITLEAKS_SHA256:?}"
tarball="$dir/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
url="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
mkdir -p "$dir"

verified() { [ -f "$1" ] && echo "${GITLEAKS_SHA256}  $1" | sha256sum -c - >/dev/null 2>&1; }

if verified "$tarball"; then
  echo "gitleaks ${GITLEAKS_VERSION}: cached tarball, checksum OK"
else
  if [ -e "$tarball" ]; then
    echo "gitleaks ${GITLEAKS_VERSION}: cached tarball does not match the pinned checksum, discarding it" >&2
    rm -f "$tarball"
  fi
  part="$tarball.part"
  rm -f "$part"
  echo "gitleaks ${GITLEAKS_VERSION}: downloading"
  fetch=(curl -sSfL --retry 5 --retry-all-errors --retry-delay 5 --connect-timeout 20 --max-time 120 -o "$part")
  if ! "${fetch[@]}" "$url"; then
    : "${GITLEAKS_ASSET_ID:?release URL failed and no GITLEAKS_ASSET_ID to fall back on}"
    echo "gitleaks ${GITLEAKS_VERSION}: release URL failed, falling back to the GitHub API asset ${GITLEAKS_ASSET_ID}" >&2
    rm -f "$part"
    auth=()
    [ -z "${GITHUB_TOKEN:-}" ] || auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
    "${fetch[@]}" "${auth[@]}" -H "Accept: application/octet-stream" \
      "${GITLEAKS_API_URL:-https://api.github.com}/repos/gitleaks/gitleaks/releases/assets/${GITLEAKS_ASSET_ID}"
  fi
  if ! verified "$part"; then
    echo "gitleaks ${GITLEAKS_VERSION}: downloaded tarball does not match the pinned checksum ${GITLEAKS_SHA256}" >&2
    rm -f "$part"
    exit 1
  fi
  mv "$part" "$tarball"
  echo "gitleaks ${GITLEAKS_VERSION}: downloaded, checksum OK"
fi

tar -xzf "$tarball" -C "$dir" gitleaks
"$dir/gitleaks" version >/dev/null
