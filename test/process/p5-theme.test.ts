import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from 'effect';
import { P5FrameControlSchema, P5ThemeMessageSchema, themeVariables } from '../../web/p5/theme.js';

const variables = Object.fromEntries(themeVariables.map(name => [name, name === '--concord-font' ? 'Inter, "Noto Sans SC Variable", system-ui, sans-serif' : '#174c51']));
const decode = Schema.decodeUnknownSync(P5FrameControlSchema, { onExcessProperty: 'error' });

// @use-case docs/feature/web-workbench/use-case/embed-p5-sketch.md#主题色
test('p5 theme messages accept literal colors and font families and preserve existing controls', () => {
  for (const color of ['#abc', '#aabbccdd', 'rebeccapurple', 'transparent', 'rgb(23, 76, 81)', 'rgb(20% 30% 40% / .8)', 'hsl(180deg 50% 40% / 80%)']) {
    const message = { kind: 'theme', variables: { ...variables, '--concord-accent': color } };
    assert.deepEqual(decode(message), message);
  }
  for (const font of ['"Noto Sans SC Variable", sans-serif', "'中文字体', system-ui", 'Inter, ui-sans-serif, -apple-system']) {
    const message = { kind: 'theme', variables: { ...variables, '--concord-font': font } };
    assert.deepEqual(decode(message), message);
  }
  assert.deepEqual(decode({ kind: 'pause' }), { kind: 'pause' });
  assert.deepEqual(decode({ kind: 'resume' }), { kind: 'resume' });
});

// @use-case docs/feature/web-workbench/use-case/embed-p5-sketch.md#执行与生命周期
test('p5 theme Schema rejects CSS injection, expressions, invalid values and undeclared variables', () => {
  const colorAttacks = ['', '#12', '#12345g', 'not-a-color', 'url(https://evil.invalid/a)', 'uRl(data:text/html,x)', 'expression(alert(1))', 'var(--parent-secret)', 'rgb(1, 2%, 3)', 'rgb(1 2)', 'rgb(1 2 3); color:red', '#fff; background:url(x)', '#fff\n}', 'rgb(calc(2 * 3) 0 0)', '/*x*/red', 'r\\65 d'];
  for (const value of colorAttacks) {
    for (const name of themeVariables.filter(name => name !== '--concord-font')) {
      assert.throws(() => decode({ kind: 'theme', variables: { ...variables, [name]: value } }), `reject ${name}: ${value}`);
    }
  }
  for (const value of ['', 'url(https://evil.invalid/font)', 'expression(alert(1))', '"url(x)"', 'Inter; color:red', 'var(--font)', 'Inter,', '"unclosed', 'Inter\n; background: red', 'Inter\\3b color:red', '12345', '-', '-123', 'Inter, inherit']) {
    assert.throws(() => decode({ kind: 'theme', variables: { ...variables, '--concord-font': value } }), `reject font: ${value}`);
  }
  assert.throws(() => decode({ kind: 'theme', variables: { ...variables, '--other': 'red' } }));
  assert.throws(() => decode({ kind: 'theme', variables: { ...variables, '--concord-font': undefined } }));
  assert.throws(() => decode({ kind: 'theme', variables, javascript: 'alert(1)' }));
  assert.throws(() => Schema.decodeUnknownSync(P5ThemeMessageSchema, { onExcessProperty: 'error' })({ kind: 'theme', variables: { ...variables, '--concord-accent': 42 } }));
});
