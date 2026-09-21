# Cross-platform tagged releases

## Command

Maintainers release by creating and pushing an annotated `concord-v<package.version>` tag on an already pushed commit. The workflow rejects a version mismatch or an existing tag/release with different identity.

## Output

The Concord release contains exactly one `concord-sdlc-<version>.tgz` with a recorded SHA-256. The tap later contains the matching Formula version/hash and Linux Nix hashes. `concord --version` must print that version from the installed candidate.

## Errors

Any source check, package identity, exact-candidate installation/check, digest, Formula or Nix failure prevents the corresponding publication step. A failed tag run does not publish a successful compatibility claim. Reruns may reuse only identical tags and bytes.

## Minimal Example

```sh
git tag -a concord-v0.5.0 -m 'Concord 0.5.0'
git push origin concord-v0.5.0
```
