import { type config_public_ProjectConfig as ProjectConfig } from "./src/model/index.ts";

export default {
  "sourceRoots": [
    "src",
    "web",
    "scripts"
  ],
  "testRoots": ["test"],
  "sourceIgnore": ["concord"],
  "runner": {
    "kind": "command",
    "prepare": [
      ["pnpm", "install", "--frozen-lockfile", "--offline"],
      ["pnpm", "exec", "vp", "run", "build:native"]
    ],
    "argv": [
      "node",
      "scripts/test-built.ts",
      "--test-name-pattern",
      "{pattern}",
      "{file}"
    ],
    "sourceFiles": [
      "test/support/support.ts",
      "test/support/installed-package.ts",
      "test/support/source-consumer.ts",
      "test/support/archive-check.ts",
      "test/support/archive-acceptance.ts",
      "test/support/archive-consumers.ts",
      "test/support/archive-native.ts",
      "test/support/archive-environment.ts",
      "test/support/archive-installer-assets.ts",
      "test/support/install-script-archive.ts",
      "test/support/install-script-archive-lifecycle.ts",
      "test/support/installed-startup.ts",
      "test/support/installed-herdr-mod.ts",
      "test/support/installed-bundles.ts",
      "test/support/package-inventory.ts",
      "test/support/repository.ts",
      "test/support/temporary.ts",
      "test/support/source-runtime.ts",
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
      "test/support/cli-load-probe.ts",
      "test/fixtures/install-consumer.ts",
      "scripts/package-command.ts",
      "scripts/package-location.ts",
      "scripts/verify-installed-native.ts",
      "scripts/assemble-release.ts",
      "scripts/gate-package.ts",
      "scripts/gate-build-cache.ts",
      "scripts/gate-resources.ts",
      "scripts/test-layers.ts",
      "tsconfig.test.json",
      ".node-version",
      "package.json",
      "pnpm-lock.yaml"
    ],
    "timeoutMs": 300000
  }
} as const satisfies ProjectConfig;
