import test from 'node:test';
import assert from 'node:assert/strict';
import { ThemeRegistry } from '../client/themes/core/registry';
import { ThemeController, type ThemeHost } from '../client/themes/core/controller';
import { ThemeScope } from '../client/themes/core/scope';
import type { ThemeDefinition, ThemeModule } from '../client/themes/core/types';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const empty: ThemeModule = { styles: [], mount() {} };
const theme = (id: string, load = async () => empty): ThemeDefinition => ({
  id,
  name: id,
  order: 1,
  themeColor: '#123456',
  preview: { background: '#123456', panel: '#fff', accent: '#abc', border: '#def' },
  load,
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(extra: ThemeDefinition[]) {
  const registry = new ThemeRegistry([theme('classic'), ...extra], 'classic');
  const sheets = new Set<string>(),
    scopes: ThemeScope[] = [],
    applied: string[] = [];
  class Scope extends ThemeScope {
    override style(css: string) {
      sheets.add(css);
      this.defer(() => sheets.delete(css));
    }
  }
  const host: ThemeHost = {
    apply: (d) => {
      applied.push(d.id);
    },
    scope: (id) => {
      const scope = new Scope(id);
      scopes.push(scope);
      return scope;
    },
  };
  return { registry, controller: new ThemeController(registry, host), sheets, scopes, applied };
}

test('registry protects the default, validates definitions and supports insertion / removal', () => {
  assert.throws(() => new ThemeRegistry([], 'classic'));
  const { registry } = setup([]);
  assert.throws(() => registry.unregister('classic'));
  assert.throws(() => registry.register(theme('classic')));
  assert.throws(() => registry.register(theme('invalid id')));
  registry.register(theme('new-theme'));
  assert.deepEqual(
    registry.list().map((t) => t.id),
    ['classic', 'new-theme'],
  );
  assert.equal(registry.unregister('new-theme'), true);
  assert.equal(registry.unregister('new-theme'), false);
});

test('only the latest requested theme can mount, and cancelling a load keeps the active instance', async () => {
  const a = deferred<ThemeModule>(),
    b = deferred<ThemeModule>();
  let mountedA = 0,
    mountedB = 0;
  const s = setup([theme('one', () => a.promise), theme('two', () => b.promise)]);
  const first = s.controller.select('one'),
    second = s.controller.select('two');
  a.resolve({
    styles: ['one'],
    mount() {
      mountedA++;
    },
  });
  await first;
  assert.equal(mountedA, 0);
  b.resolve({
    styles: ['two'],
    mount() {
      mountedB++;
    },
  });
  await second;
  assert.equal(mountedB, 1);
  assert.deepEqual([...s.sheets], ['two']);
  const pending = deferred<ThemeModule>();
  s.registry.register(theme('late', () => pending.promise));
  const loading = s.controller.select('late');
  await s.controller.select('two');
  pending.resolve({
    styles: ['late'],
    mount() {
      throw new Error('Stale theme mounted');
    },
  });
  await loading;
  assert.equal(mountedB, 1);
  assert.equal(s.scopes.length, 1);
  s.controller.dispose();
  assert.equal(s.sheets.size, 0);
});

test('switch and active removal release listeners, timers, observers, styles and disposers', async () => {
  const target = new EventTarget();
  let calls = 0,
    observed = 0,
    disposed = 0;
  const s = setup([
    theme('one', async () => ({
      styles: ['one'],
      mount(scope) {
        scope.listen(target, 'ping', () => calls++);
        scope.timeout(() => (calls += 100), 20);
        scope.observe({
          disconnect() {
            observed++;
          },
        });
        scope.defer(() => disposed++);
      },
    })),
    theme('two', async () => ({ styles: ['two'], mount() {} })),
  ]);
  await s.controller.select('one');
  target.dispatchEvent(new Event('ping'));
  assert.equal(calls, 1);
  await s.controller.select('two');
  target.dispatchEvent(new Event('ping'));
  await new Promise((done) => setTimeout(done, 30));
  assert.equal(calls, 1);
  assert.equal(observed, 1);
  assert.equal(disposed, 1);
  assert.deepEqual(s.scopes[0]!.snapshot(), {
    disposed: true,
    nodes: 0,
    observers: 0,
    timers: 0,
    frames: 0,
    listeners: 0,
  });
  s.registry.unregister('two');
  assert.equal(s.controller.snapshot().active, 'classic');
  assert.equal(s.sheets.size, 0);
  s.controller.dispose();
  s.controller.dispose();
  assert.equal(disposed, 1);
});

test('load failure keeps the active theme, may be retried, and mount failure releases partial resources', async () => {
  let fail = true;
  const s = setup([
    theme('one', async () => ({ styles: ['one'], mount() {} })),
    theme('retry', async () => {
      if (fail) throw Error('load');
      return { styles: ['retry'], mount() {} };
    }),
    theme('broken', async () => ({
      styles: ['broken'],
      mount(scope) {
        scope.listen(new EventTarget(), 'ping', () => {});
        throw Error('mount');
      },
    })),
  ]);
  await s.controller.select('one');
  assert.equal(await s.controller.select('retry'), false);
  assert.equal(s.controller.snapshot().active, 'one');
  assert.deepEqual([...s.sheets], ['one']);
  fail = false;
  assert.equal(await s.controller.select('retry'), true);
  assert.equal(await s.controller.select('broken'), false);
  assert.equal(s.controller.snapshot().active, 'classic');
  assert.equal(s.sheets.size, 0);
  assert.equal(s.scopes.at(-1)!.snapshot().listeners, 0);
});

test('removing or replacing a loading theme and disposing the controller reject late activation', async () => {
  const pending = deferred<ThemeModule>();
  let mounts = 0;
  const s = setup([theme('one', () => pending.promise)]);
  const loading = s.controller.select('one');
  s.registry.unregister('one');
  s.registry.register(
    theme('one', async () => ({
      styles: ['replacement'],
      mount() {
        mounts++;
      },
    })),
  );
  await s.controller.select('one');
  pending.resolve({
    styles: ['old'],
    mount() {
      throw Error('Old definition mounted');
    },
  });
  await loading;
  assert.equal(mounts, 1);
  assert.deepEqual([...s.sheets], ['replacement']);
  const last = deferred<ThemeModule>();
  s.registry.register(theme('last', () => last.promise));
  const task = s.controller.select('last');
  s.controller.dispose();
  last.resolve({
    styles: ['last'],
    mount() {
      throw Error('Disposed controller mounted');
    },
  });
  await task;
  assert.equal(s.sheets.size, 0);
  assert.equal(s.controller.snapshot().disposed, true);
});

test('cleanup failures are reported while remaining cleanup still runs and the default remains available', async () => {
  let released = 0;
  const s = setup([
    theme('broken-cleanup', async () => ({
      styles: ['one'],
      mount(scope) {
        scope.defer(() => released++);
        scope.defer(() => {
          throw Error('cleanup');
        });
      },
    })),
    theme('two'),
  ]);
  await s.controller.select('broken-cleanup');
  assert.equal(await s.controller.select('two'), false);
  assert.equal(released, 1);
  assert.equal(s.controller.snapshot().active, 'classic');
  assert.equal(s.controller.snapshot().failed, true);
  assert.equal(s.sheets.size, 0);
  assert.equal(await s.controller.select('two'), true);
});

test('theme ownership has no legacy root entries or imports into another optional theme', () => {
  for (const file of [
    'style.css',
    'themes.css',
    'daylight.css',
    'daylight-controls.css',
    'signal.css',
    'signal-motion.css',
    'signal-fonts.css',
    'appearance-layout.ts',
    'appearance-scene.ts',
    'appearance-signal.ts',
    'appearance-fracture.ts',
    'hover-glitch.ts',
  ])
    assert.equal(existsSync(join('client', file)), false, file);
  for (const name of ['daylight', 'signal']) {
    const dir = join('client/themes', name);
    for (const file of readdirSync(dir).filter((f) => /\.(ts|css)$/.test(f))) {
      const source = readFileSync(join(dir, file), 'utf8');
      assert.doesNotMatch(
        source,
        name === 'daylight' ? /from ['"]\.\.\/signal\// : /from ['"]\.\.\/daylight\//,
        file,
      );
    }
  }
  assert.doesNotMatch(
    readFileSync('client/appearance.ts', 'utf8'),
    /=== ['"](?:glitch|signal)['"]|new (?:GlitchScene|SignalScene)/,
  );
  assert.doesNotMatch(
    readFileSync('client/themes/shared/panels.css', 'utf8'),
    /data-theme=['"](?:glitch|signal)/,
  );
});
