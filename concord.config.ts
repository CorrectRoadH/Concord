export default {
  "sourceRoots": [
    "src",
    "web",
    "scripts"
  ],
  "testRoots": [
    "test"
  ],
  "sourceIgnore": [
    "concord"
  ],
  "runner": {
    "argv": [
      "bun",
      "--no-env-file",
      "--config=/dev/null",
      "--conditions=concord-source",
      "test",
      "--preload",
      "./test/support/source-runtime.ts",
      "--timeout",
      "120000",
      "--isolate",
      "--test-name-pattern",
      "{pattern}",
      "{file}"
    ],
    "timeoutMs": 300000
  }
} as const;
