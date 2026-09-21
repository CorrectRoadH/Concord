---
format: concord.document/v1
id: release-from-tag
title: Release tested macOS and Linux packages from a tag
createdAt: 2026-09-21T09:55:09.057Z
kind: use-case
feature: docs/feature/cross-platform-release/README.md
---

# Release tested macOS and Linux packages from a tag

## User Goal

A maintainer pushes one version tag and receives a tested Concord package plus automatically synchronized Homebrew and Linux Nix recipes without rebuilding different bytes per platform.

## Complete Path

1. Finish Concord-driven contract, implementation and test work on a pushed commit; `package.json`, shrinkwrap and CLI version agree.
2. Create and push `concord-v<version>`.
3. Source CI runs `pnpm check`, packs once, installs that artifact on macOS 14/15 Apple Silicon and Ubuntu 24.04 x86_64/arm64, and runs an isolated `init`/`check` smoke.
4. Only after every required job passes, publish the source GitHub Release and its tgz.
5. The public tap discovers the release, verifies version/tag/asset/hash, prepares Formula and Linux Nix metadata, validates candidate installs, then commits and tags the recipe.
6. Users install with `brew install CorrectRoadH/tap/concord` or the documented Nix flake and observe the tagged version.

## Result

Successful channels resolve to identical package bytes and `concord --version`. Matrix, identity, digest, runtime cleanup, Formula or Nix failures remain visible and stop their publication stage. The workflow does not claim Intel macOS, HFS, network filesystem or Windows support.

## Contract Sources

- [CLI](../cli.md)
- [Architecture](../architecture.md)
- [Lifecycle](../lifecycle.md)
- [Portable runtime and release coordination design](../../../design/portable-release-coordination/README.md)
