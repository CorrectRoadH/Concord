// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const selectors = ['.page', '.document-workspace', '.detail-drawer:not(.source-drawer) .detail-drawer__body', '.source-drawer .detail-drawer__body'];

/** Presentation cache only: never chooses a route, tab, file, or drawer. */
export function useNavigationScroll() {
  const location = useLocation();
  const action = useNavigationType();
  const positions = useRef(new Map<string, number[]>());
  const previous = useRef<{ path: string; tab: string | null; key: string } | null>(null);
  useLayoutEffect(() => {
    const params = new URLSearchParams(location.search);
    const before = previous.current;
    const samePanel = before?.path === location.pathname && before.tab === params.get('tab');
    const inherited = before ? positions.current.get(before.key) : undefined;
    const target = positions.current.get(location.key) ?? ((samePanel || action === 'REPLACE') ? inherited : undefined);
    previous.current = { path: location.pathname, tab: params.get('tab'), key: location.key };
    let restoring = !!target;
    let frame = 0;
    let stopped = false;
    const started = performance.now();
    const capture = () => {
      if (restoring) return;
      positions.current.set(location.key, selectors.map(selector => document.querySelector(selector)?.scrollTop ?? 0));
    };
    const restore = () => {
      let ready = true;
      selectors.forEach((selector, index) => {
        const element = document.querySelector(selector);
        const top = target?.[index] ?? 0;
        if (!element) { if (top) ready = false; return; }
        element.scrollTop = top;
        if (Math.abs(element.scrollTop - top) > 1) ready = false;
      });
      if (!stopped && !ready && performance.now() - started < 5000) frame = requestAnimationFrame(restore);
      else { restoring = false; capture(); }
    };
    if (target) frame = requestAnimationFrame(restore);
    else if (!samePanel && action === 'PUSH') frame = requestAnimationFrame(restore);
    const interrupt = () => { stopped = true; restoring = false; cancelAnimationFrame(frame); capture(); };
    document.addEventListener('scroll', capture, true);
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) document.addEventListener(event, interrupt, true);
    if (!target) capture();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('scroll', capture, true);
      for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) document.removeEventListener(event, interrupt, true);
    };
  }, [location.key, location.pathname, location.search, action]);
}
