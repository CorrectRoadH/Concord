import { type config_public_ProjectConfig as ProjectConfig } from "./src/model/index.js";

export default {
  "sourceRoots": [
    "src",
    "web",
    "scripts"
  ],
  "testRoots": ["test"],
  "runner": {
    "kind": "command",
    "prepare": [
      ["pnpm", "install", "--frozen-lockfile", "--offline"],
      ["pnpm", "exec", "vp", "build"]
    ],
    "argv": [
      "node",
      "--import",
      "tsx",
      "scripts/test-built.ts",
      "--test-name-pattern",
      "{pattern}",
      "{file}"
    ],
    "sourceFiles": [
      "test/support/support.ts",
      "test/support/installed-package.ts",
      "test/support/repository.ts",
      "test/support/temporary.ts",
      "test/support/cli-fixture.ts",
      "test/support/asynchronous-projections-fixture.ts",
      "test/support/lsp-analysis-fixture.ts",
      "test/support/issue-remote-fixture.ts",
      "test/support/test-adapters-consumer-fixture.ts",
      "test/e2e/fixtures.ts",
      "test/e2e/engine.ts",
      "test/e2e/local-browser.ts",
      "test/e2e/server.ts",
      "test/e2e/journey.ts",
      "e2e.config.ts",
      "scripts/test-built.ts",
      "scripts/test-reporter.ts",
      "tsconfig.test.json",
      "package.json",
      "pnpm-lock.yaml"
    ],
    "timeoutMs": 300000
  }
} as const satisfies ProjectConfig;
