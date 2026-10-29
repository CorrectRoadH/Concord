import type { ProjectConfig } from 'concord-sdlc/config';

export default {
  "format": "concord.project/v1",
  "projectId": "08dc2a8f-a386-423f-bf24-0756230dff10",
  "testRoots": [
    "test"
  ],
  "sourceRoots": [
    "src",
    "repository",
    "web",
    "scripts"
  ],
  "runner": {
    "kind": "command",
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
      "test/support.ts",
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
  },
  "constitution": {
    "path": "docs/constitution.md"
  },
  "projectTypes": [
    "library",
    "cli"
  ],
  "documentDefaults": {
    "featurePages": [
      "library",
      "cli",
      "architecture"
    ],
    "roadmapPages": [
      "library",
      "cli",
      "architecture"
    ],
    "designPages": [
      "library",
      "cli",
      "architecture"
    ]
  },
  "memorySources": [
    {
      "name": "project",
      "provider": "local-files",
      "path": "memory",
      "access": "read-write",
      "defaultWrite": true
    }
  ]
} as const satisfies ProjectConfig;
