# Cross-platform tagged releases

## Command

Maintainers release by creating and pushing an annotated `v<package.version>` tag on an already pushed commit. The workflow rejects a version mismatch or an existing tag/release with different identity.

Update `package.json`, both root versions in `npm-shrinkwrap.json`, and the CLI version before tagging. The workflow also accepts `concord-v<package.version>` for compatibility. Manual dispatch without a tag validates only and does not publish.

## Output

The Concord release contains exactly one `concord-sdlc-<version>.tgz` with a recorded SHA-256. The tap later contains the matching Formula version/hash and Linux Nix hashes. `concord --version` must print that version from the installed candidate.

## Errors

Any source check, package identity, exact-candidate installation/check, digest, Formula or Nix failure prevents the corresponding publication step. A failed tag run does not publish a successful compatibility claim. Reruns may reuse only identical tags and bytes.

## Minimal Example

```sh
git tag -a v0.7.4 -m 'Concord 0.7.4'
git push origin v0.7.4
```
