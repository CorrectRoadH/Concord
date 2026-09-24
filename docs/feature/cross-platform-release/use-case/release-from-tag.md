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

1. Finish Concord-driven contract, implementation and test work on a pushed commit; source `package.json` and shrinkwrap root versions agree.
2. Create and push `v<version>`.
3. Target jobs first build the pinned linux-x64-glibc and darwin-arm64 engines. The package job derives the release version from the tag and updates package metadata in its runner. One Ubuntu 24.04 runner builds and typechecks, packs once, verifies the digest, and installs that exact npm artifact containing both target-native engines with isolated `init`/`check` and genuine HawDB miss/hit/clear/recall checks with Rust and HawDB helpers absent from PATH.
4. Run all tests in four Ubuntu shards against the packed build, alongside the same packed build and isolated CLI installation checks on Apple Silicon macOS 14 and 15. Together the build, typecheck and test shards perform the checks exposed locally by `pnpm check`. Only after every required job passes, publish the source GitHub Release and its tgz.
5. The public tap discovers the release, verifies version/tag/asset/hash, prepares Formula and Linux Nix metadata, validates candidate installs, then commits and tags the recipe.
6. Users install with `brew install CorrectRoadH/tap/concord` or the documented Nix flake and observe the tagged version.

## Result

Successful channels resolve to identical package bytes and `concord --version`. Matrix, identity, digest, runtime cleanup, Formula or Nix failures remain visible and stop their publication stage. The workflow does not claim network/multi-host coordination or Windows execution support.

## Contract Sources

- [CLI](../cli.md)
- [Architecture](../architecture.md)
- [Lifecycle](../lifecycle.md)
- [Portable runtime and release coordination design](../../../design/portable-release-coordination/README.md)
