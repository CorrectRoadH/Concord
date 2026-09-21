# Portable runtime and release coordination

## G1: Preserve safe repository coordination

Linux and macOS operations must retain exclusive writes, concurrent safe reads, explicit recovery and unknown-edit protection without two runtime generations mutating the same owner.

## G2: Verify one package across supported platforms

One immutable tgz must pass isolated installation and init/check on the declared macOS and Linux matrix before a formal compatibility claim is published.

## G3: Automate tag-to-channel synchronization

A canonical source tag must lead to idempotent source Release, Formula and Linux Nix metadata with exact version and digest mapping, bounded retries and no version rollback.
