#!/usr/bin/env sh
# Install a pinned mcp-publisher release into the current directory, verifying
# the tarball against the checksums published with that release. Used by
# docs/registry.md and .github/workflows/mcp-registry.yml so both run the same
# binary. Bump VERSION and the four sums together.
set -eu

VERSION="1.8.1"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')"
ASSET="mcp-publisher_${OS}_${ARCH}.tar.gz"

case "$ASSET" in
  mcp-publisher_linux_amd64.tar.gz)  SUM="a06c9096dcb9727c13555b6be26c7effa707b01f06a4c561ba7a3635443cf2cc" ;;
  mcp-publisher_linux_arm64.tar.gz)  SUM="8dd75a6cf6845688b5d4e46df58d3ca26d5c8d233bb0626606e1db82c5e883e4" ;;
  mcp-publisher_darwin_amd64.tar.gz) SUM="88126981225e7714fcc6b7a10cdba4a80ae5901e9740a8c06d0d5195c8bc294c" ;;
  mcp-publisher_darwin_arm64.tar.gz) SUM="e45e520892460732a4bdf37255576415d4a53ec171f8b913faf15bb1aef7cb77" ;;
  *) echo "install-mcp-publisher: no pinned checksum for ${ASSET}" >&2; exit 1 ;;
esac

curl -fsSL -o "$ASSET" \
  "https://github.com/modelcontextprotocol/registry/releases/download/v${VERSION}/${ASSET}"

if command -v sha256sum >/dev/null 2>&1; then
  echo "${SUM}  ${ASSET}" | sha256sum -c -
else
  echo "${SUM}  ${ASSET}" | shasum -a 256 -c -
fi

tar xzf "$ASSET" mcp-publisher
rm -f "$ASSET"
./mcp-publisher --version
