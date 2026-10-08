// Run: node --unhandled-rejections=strict scripts/check-url-opening.cjs (no device required).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Execute the screen's actual arrow handler. TagInfo is diagnosis-only since 5-1 (HANDOFF §4.10), so
// link open/copy (§4.2-5) is verified on TagRead alone; TagInfo's lack of such actions: check-tag-diagnosis.cjs.
function handler(source, name, Linking, Alert, Clipboard, url) {
  const ast = ts.createSourceFile('screen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(declaration?.initializer, `Missing screen handler: ${name}`);
  const code = ts.transpileModule(`const callback = ${declaration.initializer.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function('Linking', 'Alert', 'Clipboard', 'url', `${code}\nreturn callback;`)(
    Linking, Alert, Clipboard, url,
  );
}

(async () => {
  const failure = ['링크 열기', '링크를 열지 못했습니다. 다시 시도해 주세요.'];
  for (const [screen, openName] of [['TagReadScreen', 'onOpen']]) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src/screens', `${screen}.tsx`), 'utf8');
    assert.match(source, /onPress=\{\(\) => onOpen\(u\)\}/);
    assert.match(source, /onLongPress=\{\(\) => onCopy\(u\)\}/, 'Long press must still copy');
    for (const url of [
      'https://instagram.com/Mixed_Name',
      'https://www.instagram.com/Mixed_Name/',
      'https://example.com/A%2Fb?token=A~B&flag#Keep',
    ]) {
      for (const queryRejects of [false, true]) {
        let queries = 0;
        const opened = [];
        const alerts = [];
        const Linking = {
          canOpenURL: async () => {
            queries++;
            if (queryRejects) throw new Error('Package query failed');
            return false;
          },
          openURL: async (value) => { opened.push(value); },
        };
        const Alert = { alert: (...args) => alerts.push(args) };
        const open = handler(source, openName, Linking, Alert, {}, url);
        await assert.doesNotReject(() => open(url));
        assert.deepEqual(opened, [url], `${screen}: attempt opening the original URL`);
        assert.equal(queries, 0, `${screen}: no package query gate`);
        assert.deepEqual(alerts, [], `${screen}: successful opening must not alert`);

        Linking.openURL = async (value) => { opened.push(value); throw new Error('VIEW failed'); };
        await assert.doesNotReject(() => open(url), `${screen}: actual rejection must be handled`);
        await new Promise(setImmediate); // Strict mode also catches any detached rejected promise.
        assert.deepEqual(opened, [url, url]);
        assert.deepEqual(alerts, [failure], `${screen}: one consistent failure alert`);
        alerts.length = 0;

        const copied = [];
        const Clipboard = { setStringAsync: async (value) => { copied.push(value); return true; } };
        const copy = handler(source, 'onCopy', Linking, Alert, Clipboard, url);
        await copy(url);
        assert.deepEqual(copied, [url], `${screen}: copy original URL`);
        assert.deepEqual(alerts, [['주소 복사', 'URL을 클립보드에 복사했습니다.']]);
        assert.deepEqual(opened, [url, url], `${screen}: copy must not open URL`);
        alerts.length = 0;
        Clipboard.setStringAsync = async () => { throw new Error('Copy failed'); };
        await assert.doesNotReject(() => copy(url));
        assert.deepEqual(alerts, [['복사 실패', 'URL을 복사하지 못했습니다. 다시 시도해 주세요.']]);
      }
    }
  }
  console.log('PASS: TagRead screen handler; canOpenURL false/reject bypassed; original URLs; open success/failure; copy preserved');
})().catch((error) => { console.error(error); process.exitCode = 1; });
