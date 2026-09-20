// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { Schema } from 'effect';
import { useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { SourceLocation } from '../components/source-drawer';

// Only history provenance lives here. Visible navigation is always read from URL.
const session = Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
const Origin = Schema.Struct({ session: Schema.String, parent: Schema.String, child: Schema.String });
const Source = Schema.Struct({ path: Schema.String, line: Schema.Int, endLine: Schema.Int });

export function urlChoice<const Values extends readonly string[]>(value: string | null, values: Values, fallback: Values[number]): Values[number] {
  try { return Schema.decodeUnknownSync(Schema.Literals(values))(value); }
  catch { return fallback; }
}

export function useUrlNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const href = location.pathname + location.search + location.hash;
  function update(values: Record<string, string | null>, replace = false) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value === null) next.delete(key); else next.set(key, value);
    }
    const search = next.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace });
  }
  function opening(child: string) { return { session, parent: href, child }; }
  function close(parent: string) {
    const origin: unknown = location.state;
    if (Schema.is(Origin)(origin) && origin.session === session && origin.child === href && origin.parent === parent) navigate(-1);
    else navigate(parent, { replace: true });
  }
  return { params, update, href, opening, close, navigate, location };
}

export function useSourceNavigation() {
  const navigation = useUrlNavigation();
  const path = navigation.params.get('source');
  const line = navigation.params.get('sourceLine') ?? '1';
  const endLine = navigation.params.get('sourceEndLine') ?? line;
  const location = useMemo<SourceLocation | null>(() => {
    if (!path) return null;
    try {
      const decoded = Schema.decodeUnknownSync(Source)({ path, line: Number(line), endLine: Number(endLine) });
      return decoded.line > 0 && decoded.endLine >= decoded.line ? decoded : null;
    } catch { return null; }
  }, [path, line, endLine]);
  function parentUrl() {
    const params = new URLSearchParams(navigation.params);
    for (const key of ['source', 'sourceLine', 'sourceEndLine']) params.delete(key);
    return navigation.location.pathname + (params.size ? `?${params}` : '') + navigation.location.hash;
  }
  function open(next: SourceLocation) {
    const params = new URLSearchParams(navigation.params);
    params.set('source', next.path);
    params.set('sourceLine', String(next.line));
    params.set('sourceEndLine', String(next.endLine));
    const child = navigation.location.pathname + `?${params}` + navigation.location.hash;
    navigation.navigate(child, { state: navigation.opening(child) });
  }
  return { location, open, close: () => navigation.close(parentUrl()) };
}
