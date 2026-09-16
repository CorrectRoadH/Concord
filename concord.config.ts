import type { ProjectConfig } from 'concord-sdlc/config';

export default {
  "format": "concord.project/v1",
  "projectId": "08dc2a8f-a386-423f-bf24-0756230dff10",
  "testRoots": [
    "test"
  ],
  "sourceRoots": [
    "src",
    "web"
  ],
  "runner": {
    "kind": "command",
    "argv": [
      "node",
      "--import",
      "tsx",
      "--test",
      "--test-name-pattern",
      "{pattern}",
      "{file}"
    ],
    "sourceFiles": [
      "test/support.ts",
      "tsconfig.test.json",
      "package.json",
      "pnpm-lock.yaml"
    ],
    "timeoutMs": 120000
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
