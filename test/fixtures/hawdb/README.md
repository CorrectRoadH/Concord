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
