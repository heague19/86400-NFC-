// Execute the installed RN event dispatcher and NavigationContainer back hook; mock only native boundaries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const babel = require('@babel/core');

function evaluate(code, imports) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    assert.ok(Object.hasOwn(imports, name), `Unexpected back-handler import: ${name}`);
    return imports[name];
  }, module, module.exports);
  return module.exports;
}

module.exports = function hardwareBack(navigation) {
  let emit, cleanup, defaults = 0;
  const rnRoot = path.dirname(require.resolve('react-native/package.json'));
  const code = babel.transformSync(fs.readFileSync(path.join(rnRoot, 'Libraries/Utilities/BackHandler.android.js'), 'utf8'), {
    babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-flow-strip-types', '@babel/plugin-transform-modules-commonjs'],
  }).code;
  const BackHandler = evaluate(code, {
    '../../Libraries/NativeModules/specs/NativeDeviceEventManager': { invokeDefaultBackPressHandler: () => ++defaults },
    '../EventEmitter/RCTDeviceEventEmitter': { addListener: (event, callback) => {
      assert.equal(event, 'hardwareBackPress'); emit = callback;
    } },
  });
  const navRoot = path.dirname(require.resolve('@react-navigation/native/package.json'));
  const hookCode = ts.transpileModule(fs.readFileSync(path.join(navRoot, 'src/useBackButton.native.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  evaluate(hookCode, {
    react: { useEffect: (effect) => { cleanup = effect(); } },
    'react-native': { BackHandler },
  }).useBackButton({ current: navigation });
  return {
    press: () => { const before = defaults; emit(); return before === defaults; },
    get defaults() { return defaults; },
    dispose: () => cleanup(),
  };
};
