---
format: concord.document/v1
id: cross-platform-release
title: Cross-platform tagged releases
createdAt: 2026-09-21T09:55:08.120Z
kind: feature
constitutionRefs:
  - docs/constitution.md#c-002
  - docs/constitution.md#c-003
  - docs/constitution.md#c-004
  - docs/constitution.md#c-005
  - docs/constitution.md#c-006
  - docs/constitution.md#c-007
  - docs/constitution.md#c-010
---

# Cross-platform tagged releases

## Problem

Concord's published package and Homebrew formula are Linux-only even though its Node runtime and POSIX process ownership can support macOS. A maintainer currently has to pack, upload, hash, edit the tap, and verify each platform by hand, so a tag does not identify one tested release.

## Core Mental Model

The Concord repository owns source, version and source tag. Its tag workflow builds one immutable package and publishes it only after the same bytes pass the supported OS matrix. The public Homebrew tap discovers that release, verifies its identity, updates Formula and Linux-only Nix inputs, tests the candidate recipe, then records its own recipe tag. The two tags share a version but identify different commits.

Concord-driven development applies to this workflow itself: the contract and design are updated before runtime or release automation. Platform checks, explicit implementation relationships and tests remain evidence of their actual scope.

## Scope

The release is fully tested on Linux x86_64/aarch64 and built and packed on Apple Silicon macOS 14/15. Runtime support on macOS remains limited to local APFS and requires Node.js 24.15+, Git, `ripgrep` and `flock`; Homebrew supplies those helpers, including the keg-only `util-linux` flock. Nix remains Linux-only. Windows, Intel macOS, HFS and network filesystems are outside the current compatibility claim.

## Entry Points

- [CLI](cli.md)
- [Architecture](architecture.md)
- [Lifecycle](lifecycle.md)
