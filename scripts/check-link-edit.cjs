// Run: node --unhandled-rejections=strict scripts/check-link-edit.cjs (no device/new dependencies).
// Transpile and execute the actual provider/screens with a small hook host and installed StackRouter.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { StackRouter, StackActions } = require('@react-navigation/routers');
const root = path.resolve(__dirname, '..');
let currentHost;
const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  createContext: () => ({ Provider: 'Provider' }),
  useContext: () => currentHost.harness.provider.tree.props.value,
  useState: (initial) => {
    const host = currentHost;
    const index = host.cursor++;
    if (!host.slots[index]) host.slots[index] = { value: typeof initial === 'function' ? initial() : initial };
    const slot = host.slots[index];
    return [slot.value, (next) => {
      if (!host.alive) return;
      const value = typeof next === 'function' ? next(slot.value) : next;
      if (!Object.is(value, slot.value)) { slot.value = value; host.dirty = true; }
    }];
  },
  useRef: (initial) => {
    const host = currentHost;
    const index = host.cursor++;
    if (!host.slots[index]) host.slots[index] = { current: initial };
    return host.slots[index];
  },
  useMemo: (fn, deps) => {
    const host = currentHost;
    const index = host.cursor++;
    if (!sameDeps(host.slots[index]?.deps, deps)) host.slots[index] = { value: fn(), deps };
    return host.slots[index].value;
  },
  useCallback: (fn, deps) => React.useMemo(() => fn, deps),
  useEffect: (fn, deps) => {
    const host = currentHost;
    const index = host.cursor++;
    if (!sameDeps(host.slots[index]?.deps, deps)) {
      const previous = host.slots[index];
      const slot = host.slots[index] = { deps };
      host.effects.push(() => { previous?.cleanup?.(); slot.cleanup = fn(); });
    }
  },
};

class HookHost {
  constructor(harness, component, props) {
    Object.assign(this, { harness, component, props, slots: [], effects: [], alive: true, dirty: true });
  }
  render() {
    this.dirty = false;
    this.cursor = 0;
    currentHost = this;
    this.tree = this.component(this.props);
    for (const effect of this.effects.splice(0)) effect();
    currentHost = undefined;
  }
  dispose() {
    for (const slot of this.slots) slot?.cleanup?.();
    this.alive = false;
  }
}

function load(file, imports) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
    return imports[name];
  }, module, module.exports);
  return module.exports;
}

const model = load('src/models/linkType.ts', {});
const size = load('src/utils/ndefSize.ts', {});
const normalizer = load('src/utils/urlNormalizer.ts', {});
const state = load('src/state/LinkWriterContext.tsx', {
  react: React, '@/models/linkType': model, '@/utils/ndefSize': size,
});
const tokens = load('src/theme/tokens.ts', {});
let reads = 0;
let writes = [];
let readResult;
const service = { NfcService: {
  isSupported: async () => true,
  readUrl: async () => { ++reads; return typeof readResult === 'function' ? readResult() : readResult; },
  writeUrls: async (urls) => { writes.push(urls); return { ok: true, message: 'saved' }; },
} };
const placeholders = (...names) => Object.fromEntries(names.map((name) => [name, name]));
const imports = {
  react: React,
  'react-native': { ...placeholders('Image', 'ScrollView', 'Text', 'View', 'Pressable', 'KeyboardAvoidingView', 'Switch'),
    StyleSheet: { create: (v) => v }, Alert: { alert: () => {} }, Linking: {}, Platform: { OS: 'android' } },
  'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  'expo-clipboard': {},
  '@/components/AppButton': placeholders('AppPrimaryButton', 'AppSecondaryButton'),
  '@/components/AppCards': placeholders('AppInfoCard', 'AppActionCard'),
  '@/components/AppCapacityGauge': placeholders('AppCapacityGauge'),
  '@/components/AppRingBadge': placeholders('AppRingBadge'),
  '@/components/AppTextField': placeholders('AppTextField'),
  '@/state/LinkWriterContext': state,
  '@/models/linkType': model,
  '@/utils/ndefSize': size,
  '@/utils/urlNormalizer': normalizer,
  '@/nfc/nfcService': service,
  '@/theme/icons': { APP_ICONS: {}, APP_LOGO: {}, linkTypeIcon: () => 1 },
  '@/theme/tokens': tokens,
};
const screens = {};
for (const name of ['Home', 'LinkEdit', 'TagRead', 'LinkTypeSelect', 'InstagramInput', 'CustomUrlInput']) {
  screens[name] = load(`src/screens/${name}Screen.tsx`, imports)[`${name}Screen`];
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

class Harness {
  constructor() {
    reads = 0;
    writes = [];
    this.hosts = new Map();
    this.listeners = new Map();
    this.router = StackRouter({ initialRouteName: 'Home' });
    this.options = { routeNames: ['Home', 'LinkEdit', 'TagRead', 'LinkTypeSelect', 'InstagramInput', 'CustomUrlInput', 'WriteComplete', 'TagInfo'],
      routeParamList: {}, routeGetIdList: {} };
    this.stack = this.router.getInitialState(this.options);
    this.provider = new HookHost(this, state.LinkWriterProvider, { children: null });
    this.sync();
    this.flush();
  }
  get route() { return this.stack.routes[this.stack.index]; }
  get editor() { return this.hosts.get(this.route.key); }
  get context() { return this.provider.tree.props.value; }
  nav(key) {
    return {
      isFocused: () => this.route.key === key,
      addListener: (event, fn) => {
        assert.equal(event, 'blur');
        if (!this.listeners.has(key)) this.listeners.set(key, new Set());
        this.listeners.get(key).add(fn);
        return () => this.listeners.get(key).delete(fn);
      },
      navigate: (name, params) => this.dispatch({ type: 'NAVIGATE', payload: { name, params } }),
      popTo: (...args) => this.dispatch(StackActions.popTo(...args)),
    };
  }
  dispatch(action) {
    const previous = this.route;
    const next = this.router.getStateForAction(this.stack, action, this.options);
    assert.ok(next, `Rejected navigation: ${action.type}`);
    this.stack = next;
    if (previous.key !== this.route.key) for (const fn of this.listeners.get(previous.key) ?? []) fn();
    this.sync();
    this.flush();
  }
  sync() {
    for (const [key, host] of this.hosts) {
      if (!this.stack.routes.some((r) => r.key === key)) { host.dispose(); this.hosts.delete(key); }
    }
    for (const route of this.stack.routes) {
      if (!screens[route.name]) continue;
      const host = this.hosts.get(route.key);
      if (!host) this.hosts.set(route.key, new HookHost(this, screens[route.name], { navigation: this.nav(route.key), route }));
      else if (host.props.route !== route) { host.props.route = route; host.dirty = true; }
    }
  }
  flush() {
    for (let i = 0; i < 30; ++i) {
      const dirty = [this.provider, ...this.hosts.values()].filter((h) => h.alive && h.dirty);
      if (!dirty.length) return;
      for (const host of dirty) {
        host.render();
        // A provider update also schedules every mounted context consumer.
        if (host === this.provider) for (const consumer of this.hosts.values()) consumer.dirty = true;
      }
    }
    assert.fail('Hooks failed to settle');
  }
  async settle() { await new Promise(setImmediate); this.flush(); }
  find(type, predicate = () => true) {
    const node = nodes(this.editor.tree).find((n) => n.type === type && predicate(n.props));
    assert.ok(node, `Missing ${type} on ${this.route.name}`);
    return node.props;
  }
  press(label) {
    const node = nodes(this.editor.tree).find((n) => n.props?.label === label && n.props.onPress);
    assert.ok(node, `Missing button: ${label}`);
    assert.ok(!node.props.disabled && !node.props.loading, `Inactive button: ${label}`);
    const result = node.props.onPress();
    this.flush();
    return result;
  }
  enterEdit() { this.find('AppActionCard', (p) => p.title === '링크 편집').onPress(); this.flush(); }
  back() { this.dispatch({ type: 'GO_BACK' }); }
  dispose() { for (const host of [this.provider, ...this.hosts.values()]) host.dispose(); }
}

const urls = [
  'https://example.com/A%2fb?token=A~B&utm_source=other&flag#Keep',
  'https://www.instagram.com/Mixed_Name/',
  'https://example.com/A%2fb?token=A~B&utm_source=other&flag#Keep',
];
const success = (list = urls, capacity = 512) => ({ ok: true, url: list[0], urls: list, capacity, writable: true, message: 'read' });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const contextUrls = (h) => h.context.links.map((l) => l.normalizedUrl);

(async () => {
  readResult = success();
  let h = new Harness();
  h.context.replaceFromTag(['https://previous.example'], 42);
  h.flush();
  h.enterEdit();
  assert.equal(reads, 1, 'Home entry starts exactly one read');
  assert.deepEqual(contextUrls(h), [], 'Previous tag cleared before read completion');
  assert.equal(h.context.capacity, undefined);
  assert.ok(!nodes(h.editor.tree).some((n) => n.props?.label === '저장' || n.props?.label === '링크 추가'));
  await h.find('AppPrimaryButton').onPress();
  assert.equal(reads, 1, 'Rapid duplicate read actions do not open another session');
  await h.settle();
  assert.deepEqual(contextUrls(h), urls, 'Whole replacement preserves URL order, duplicates and strings');
  assert.deepEqual(h.context.links.map((l) => l.originalInput), urls);
  assert.equal(h.find('AppCapacityGauge').total, 512);
  const editKey = h.route.key;
  h.press('링크 추가');
  h.find('AppActionCard', (p) => p.title === 'Instagram').onPress(); h.flush();
  h.find('AppTextField').onChangeText('new_account'); h.flush();
  h.press('다음');
  assert.equal(h.route.key, editKey, 'Add returns to the same mounted editor');
  assert.equal(reads, 1, 'Add return does not re-read');
  assert.deepEqual(contextUrls(h), [...urls, 'https://instagram.com/new_account']);
  assert.equal(h.context.capacity, 512);
  h.find('Pressable', (p) => nodes(p.children).some((n) => n.type === 'Text' && n.props.children.includes(urls[0]))).onPress();
  h.flush();
  assert.deepEqual(h.route.params, { editIndex: 0 });
  h.find('AppTextField').onChangeText('https://edited.example/updated'); h.flush();
  h.press('다음');
  assert.equal(h.route.key, editKey, 'Edit returns to the same editor');
  assert.equal(reads, 1);
  assert.deepEqual(contextUrls(h), ['https://edited.example/updated', ...urls.slice(1), 'https://instagram.com/new_account']);
  assert.equal(h.find('AppCapacityGauge').total, 512);
  await h.press('저장'); await h.settle();
  assert.deepEqual(writes, [contextUrls(h)], 'Save uses the retained/edited full list');
  const retained = [...contextUrls(h)];
  h.dispatch({ type: 'NAVIGATE', payload: { name: 'LinkEdit', params: { urls: retained, capacity: h.context.capacity } } });
  assert.equal(reads, 1, 'A future completion can supply written URLs/capacity without a read');
  assert.deepEqual(contextUrls(h), retained);
  h.dispose();

  readResult = success(); h = new Harness();
  h.dispatch({ type: 'NAVIGATE', payload: { name: 'TagRead' } });
  await h.press('태그 읽기'); await h.settle();
  const beforeTransfer = reads;
  h.press('수정하기'); await h.settle();
  assert.equal(reads - beforeTransfer, 0, 'TagRead transfer starts zero reads');
  assert.deepEqual(h.route.params, { urls, capacity: 512, writable: true });
  assert.deepEqual(contextUrls(h), urls);
  const suppliedParams = h.route.params;
  h.find('Pressable', (p) => nodes(p.children).some((n) => n.type === 'Text' && n.props.children.includes(urls[0]))).onPress(); h.flush();
  h.find('AppTextField').onChangeText('https://updated.example/path'); h.flush(); h.press('다음');
  assert.equal(h.route.params, suppliedParams, 'Input popTo merge preserves supplied entry params');
  assert.equal(reads, beforeTransfer);
  assert.equal(contextUrls(h)[0], 'https://updated.example/path', 'Return must not reload original supplied URLs');
  assert.equal(h.context.capacity, 512);
  h.dispose();

  readResult = success(); h = new Harness(); h.enterEdit(); await h.settle(); h.back();
  readResult = success(['https://new-tag.example'], 137); h.enterEdit(); await h.settle();
  assert.deepEqual(contextUrls(h), ['https://new-tag.example']); assert.equal(h.context.capacity, 137); h.back();
  readResult = { ok: false, reason: 'no_url', urls: [], capacity: 137, writable: true, message: 'no URLs' };
  h.enterEdit(); await h.settle();
  assert.deepEqual(contextUrls(h), []); assert.equal(h.find('AppCapacityGauge').total, 137);
  assert.equal(h.find('AppPrimaryButton', (p) => p.label === '저장').disabled, true);
  h.press('링크 추가'); // A confirmed empty tag can start editing.
  h.dispose();

  for (const result of [
    ...['failed', 'cancelled', 'unsupported', 'disabled', 'not_ndef', 'status_unknown', 'unknown', 'no_url']
      .map((reason) => ({ ok: false, reason, message: reason })),
    { ok: false, reason: 'no_url', urls: [], capacity: 137, writable: false, message: 'read only' },
    { ok: false, reason: 'no_url', urls: [], writable: true, message: 'unknown capacity' },
    { ...success(), capacity: 0 }, { ...success(), writable: false },
    () => Promise.reject(new Error('unexpected read failure')),
  ]) {
    readResult = result; h = new Harness(); h.context.replaceFromTag(urls, 512); h.flush();
    h.enterEdit(); await h.settle();
    assert.deepEqual(contextUrls(h), []); assert.equal(h.context.capacity, undefined);
    assert.ok(!nodes(h.editor.tree).some((n) => n.props?.label === '저장' || n.props?.label === '링크 추가'));
    assert.equal(reads, 1, 'Read failure waits for a manual retry');
    assert.equal(writes.length, 0); h.dispose();
  }

  const old = deferred(); readResult = () => old.promise; h = new Harness(); h.enterEdit();
  const abandoned = h.editor;
  h.back(); readResult = success(['https://latest.example'], 256); h.enterEdit(); await h.settle();
  old.resolve(success(['https://stale.example'], 42)); await h.settle();
  assert.equal(abandoned.alive, false); assert.deepEqual(contextUrls(h), ['https://latest.example']);
  assert.equal(h.context.capacity, 256); h.dispose();

  const blurred = deferred(); readResult = () => blurred.promise; h = new Harness(); h.enterEdit();
  h.dispatch({ type: 'NAVIGATE', payload: { name: 'TagInfo' } }); h.back();
  readResult = success(['https://retry.example'], 137);
  await h.press('다시 읽기'); await h.settle();
  blurred.resolve(success(['https://late-blurred.example'], 42)); await h.settle();
  assert.deepEqual(contextUrls(h), ['https://retry.example']); assert.equal(h.context.capacity, 137);
  h.dispose();

  readResult = success(); h = new Harness(); h.dispatch({ type: 'NAVIGATE', payload: { name: 'TagRead' } });
  await h.press('태그 읽기'); await h.settle();
  const pending = deferred(); readResult = () => pending.promise;
  const oldEdit = h.find('AppPrimaryButton', (p) => p.label === '수정하기').onPress;
  const first = h.press('다시 읽기');
  oldEdit(); // Even an already captured button must not open editing during a new read.
  assert.equal(h.route.name, 'TagRead');
  h.dispatch({ type: 'NAVIGATE', payload: { name: 'TagInfo' } }); h.back();
  readResult = success(['https://latest-read.example'], 137);
  await h.press('태그 읽기'); await h.settle();
  pending.resolve(success(['https://stale-read.example'])); await first; await h.settle();
  h.press('수정하기'); assert.deepEqual(contextUrls(h), ['https://latest-read.example']);
  h.dispose();

  for (const reason of ['cancelled', 'failed', 'status_unknown']) {
    readResult = success(); h = new Harness(); h.dispatch({ type: 'NAVIGATE', payload: { name: 'TagRead' } });
    await h.press('태그 읽기'); await h.settle();
    readResult = { ok: false, reason, message: reason };
    await h.press('다시 읽기'); await h.settle();
    assert.ok(!nodes(h.editor.tree).some((n) => n.props?.label === '수정하기'));
    h.dispose();
  }
  for (const result of [{ ...success(), writable: false }, { ...success(), capacity: undefined }]) {
    readResult = result; h = new Harness(); h.dispatch({ type: 'NAVIGATE', payload: { name: 'TagRead' } });
    await h.press('태그 읽기'); await h.settle();
    const edit = h.find('AppPrimaryButton', (p) => p.label === '수정하기');
    assert.equal(edit.disabled, true); edit.onPress(); assert.equal(h.route.name, 'TagRead'); h.dispose();
  }
  console.log('PASS: actual Home/TagRead/editor/provider/input handlers and installed StackRouter; reads 1/0/0; retained edits/capacity; full replacement/blank tags; URL order/duplicates/strings; failures/cancel; unmount/blur/newer-read races');
})().catch((error) => { console.error(error); process.exitCode = 1; });
