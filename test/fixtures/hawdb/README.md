# Legacy cache fixture

`v0.3.0-cache.tar.gz` contains a closed database created by Concord's public
bridge pinned to HawDB revision `1e9f76428be6649a18a6f99d75b0ccfef16bf545`.
It contains table schema 1 and two rows:

| Namespace | Key | Payload |
| --- | --- | --- |
| config_cache | legacy-config | retained Ω config |
| feedback_cache | legacy-feedback | retained remote observation |

The archive has no native executable or legacy runtime. Upgrade tests extract it
into an isolated temporary directory and open it through the current public
bridge. The fixture tests existing storage adoption, not source-format compatibility.

SHA-256: `a02d9e04ed6ca29d15491535e0806166ac37286638e012abf3d40cecc92454d5`.

`v0.13.0-cache.tar.gz` is a closed schema-1 cache from the bridge pinned to
HawDB revision `91aec4960ed27516962cf1dc918307f57faef15d`. It contains one
`code_cache` row: key `v013`, payload `old disposable data`. It verifies
read-only rejection and guarded replacement when upgrading to v0.28.0.
It contains data only, with no compiler or executable.

SHA-256: `9ad5fd3c66b9218bfbea2af3211299129480f429770965c32198d52476cfc4b3`.
