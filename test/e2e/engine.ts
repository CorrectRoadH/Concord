import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { web } from '@e2e-dev/web';
import { defineEngine, type EngineHandle } from 'e2e/engine';
import { browserWorkerFixture, closeBrowserAttempt, closeBrowserWorker, openBrowserWorker } from '../support/browser-shared-fixture.ts';
import { localBrowser } from './local-browser.ts';
import { BrowserAttemptTimer, recordBrowserTiming } from '../../scripts/gate-timings.ts';
import { installProcessEvents } from '../support/process-events.ts';
import { processEventsHealthy, recordProcessEvent } from '../../src/base/process/index.ts';

const executable = process.env.CONCORD_BROWSER_PATH ??
  (existsSync('/run/current-system/sw/bin/chromium') ? '/run/current-system/sw/bin/chromium' : chromium.executablePath());

export const webEngine: EngineHandle = web({
  browser: localBrowser(executable),
  viewport: { width: 1440, height: 900 },
  timezoneId: 'Asia/Taipei',
});

const { capabilities: _capabilities, ...delegate } = webEngine;
let workerID: string | undefined;
let attemptTimer: BrowserAttemptTimer | undefined;
let endExecution: ((success: boolean) => void) | undefined;

/** Extend the official worker lifecycle; the Web engine keeps browser/context ownership. */
export const engine: EngineHandle = defineEngine({
  ...delegate,
  async init(info) {
    workerID = `${info.runId}/${info.targetName}/${info.workerSlot}`;
    if (info.env.CONCORD_TEST_EVENT_DIRECTORY !== undefined && info.env.CONCORD_TEST_RUN_ID !== undefined) {
      process.env.CONCORD_TEST_EVENT_DIRECTORY = info.env.CONCORD_TEST_EVENT_DIRECTORY;
      process.env.CONCORD_TEST_RUN_ID = info.env.CONCORD_TEST_RUN_ID;
      process.env.CONCORD_TEST_FILE_ID = fileURLToPath(import.meta.url);
      process.env.CONCORD_TEST_EVENT_SCOPE = 'browser-worker';
      process.env.CONCORD_TEST_WORKER_ID = workerID;
      installProcessEvents();
    }
    await recordBrowserTiming('worker-start', async () => {
      await openBrowserWorker(info.signal, workerID);
      try { await webEngine.init?.(info); }
      catch (cause) { await closeBrowserWorker(workerID); throw cause; }
    }, workerID);
  },
  async startAttempt(context) {
    const timer = new BrowserAttemptTimer(context.attemptId, context.artifactsDir, workerID);
    attemptTimer = timer;
    BrowserAttemptTimer.current = timer;
    await timer.persist();
    browserWorkerFixture().timer = timer;
    browserWorkerFixture().signal = context.signal;
    await browserWorkerFixture().restore(context.signal);
    await timer.measure('engine-start', async () => { await webEngine.startAttempt?.(context); });
    endExecution = timer.begin('case-execution');
  },
  async endAttempt(context) {
    const timer = attemptTimer;
    endExecution?.(!context.signal.aborted);
    endExecution = undefined;
    try {
      const stop = async () => { await webEngine.endAttempt?.(context); };
      await closeBrowserAttempt(() => timer ? timer.measure('engine-stop', stop) : stop());
    } finally {
      await timer?.persist(true);
      if (timer) browserWorkerFixture().timer = undefined;
      BrowserAttemptTimer.current = undefined;
      attemptTimer = undefined;
    }
  },
  async dispose(context) {
    let cleanupComplete = false;
    try {
      await recordBrowserTiming('worker-stop', async () => {
        try { await webEngine.dispose?.(context); }
        finally { await closeBrowserWorker(workerID); }
      }, workerID);
      cleanupComplete = true;
    } finally {
      recordProcessEvent({ kind: 'coverage-end', healthy: cleanupComplete && processEventsHealthy() }, process.env);
    }
  },
});
