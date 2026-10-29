import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { web } from '@e2e-dev/web';
import type { EngineHandle } from 'e2e/engine';
import { localBrowser } from './local-browser.js';

const executable = process.env.CONCORD_BROWSER_PATH ??
  (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : chromium.executablePath());

export const engine: EngineHandle = web({
  browser: localBrowser(executable),
  viewport: { width: 1440, height: 900 },
  timezoneId: 'Asia/Taipei',
});
