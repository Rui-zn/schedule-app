'use strict';

/**
 * CI 诊断脚本（临时）：在运行器上复现 autostart 快捷方式创建的失败路径。
 * 用完即删。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const autostart = require('../src/main/autostart');

function psEncode(s) { return Buffer.from(s, 'utf16le').toString('base64'); }
function psQuote(v) { return `'${String(v).replace(/'/g, "''")}'`; }

function runPs(script) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', psEncode(script)],
      { timeout: 15000, windowsHide: true },
      (err, so, se) => resolve({ ok: !err, msg: err ? (se || so || err.message).trim().slice(0, 300) : 'OK' })
    );
  });
}

async function make(lnkPath, label) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$ws = New-Object -ComObject WScript.Shell',
    `$sc = $ws.CreateShortcut(${psQuote(lnkPath)})`,
    `$sc.TargetPath = ${psQuote(process.execPath)}`,
    `$sc.IconLocation = ${psQuote(`${process.execPath}, 0`)}`,
    '$sc.Save()'
  ].join('\n');
  const r = await runPs(script);
  console.log(label, '=>', r.ok ? 'OK' : `FAIL: ${r.msg}`);
  return r.ok;
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-'));
  const startup = autostart.startupFolder(dir);
  fs.mkdirSync(startup, { recursive: true });
  console.log('tmpdir:', dir);
  console.log('startup exists:', fs.existsSync(startup), '->', startup);
  console.log('node tmpdir:', os.tmpdir());

  const results = [];
  results.push(await make(path.join(dir, 'plain-unicode.lnk'), '1. 平铺目录 + 中文名'));
  results.push(await make(path.join(startup, 'ascii-nested.lnk'), '2. Start Menu 嵌套 + ASCII 名'));
  results.push(await make(path.join(startup, 'unicode-nested.lnk'), '3. Start Menu 嵌套 + 中文名'));
  results.push(await make(autostart.shortcutPath(dir), '4. 完整真实路径（真实文件名）'));

  console.log('startup contents:', fs.existsSync(startup) ? fs.readdirSync(startup) : 'N/A');
  console.log('plain contents:', fs.readdirSync(dir));

  if (results.every(Boolean)) {
    console.log('DIAG_ALL_OK');
  } else {
    console.log('DIAG_SOME_FAIL');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
