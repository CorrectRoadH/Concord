import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { web } from '@e2e-dev/web';
import { defineEngine, type EngineHandle } from 'e2e/engine';
import { browserWorkerFixture, closeBrowserAttempt, closeBrowserWorker, openBrowserWorker } from '../support/browser-shared-fixture.ts';
import { localBrowser } from './local-browser.ts';

const executable = process.env.CONCORD_BROWSER_PATH ??
  (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : chromium.executablePath());

export const webEngine: EngineHandle = web({
  browser: localBrowser(executable),
  viewport: { width: 1440, height: 900 },
  timezoneId: 'Asia/Taipei',
});

const { capabilities: _capabilities, ...delegate } = webEngine;

/** Extend the official worker lifecycle; the Web engine keeps browser/context ownership. */
export const engine: EngineHandle = defineEngine({
  ...delegate,
  async init(info) {
    await openBrowserWorker(info.signal);
    try { await webEngine.init?.(info); }
    catch (cause) { await closeBrowserWorker(); throw cause; }
  },
  async startAttempt(context) {
    browserWorkerFixture().signal = context.signal;
    await browserWorkerFixture().restore(context.signal);
    await webEngine.startAttempt?.(context);
  },
  async endAttempt(context) {
    try { await webEngine.endAttempt?.(context); }
    finally { await closeBrowserAttempt(); }
  },
  async dispose(context) {
    try { await webEngine.dispose?.(context); }
    finally { await closeBrowserWorker(); }
  },
});
