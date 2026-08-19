'use strict';

/**
 * 开机自启模块测试：在临时目录中创建/读取/删除启动文件夹快捷方式。
 * 运行：npm test（不会触碰真实的用户启动文件夹）。
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const autostart = require('../src/main/autostart');

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function readShortcut(lnkPath) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$ws = New-Object -ComObject WScript.Shell',
    `$sc = $ws.CreateShortcut(${psQuote(lnkPath)})`,
    'Write-Output $sc.TargetPath',
    'Write-Output $sc.Arguments',
    'Write-Output $sc.WorkingDirectory'
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: 15000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || stdout || err.message).trim()));
        else {
          const [target, args, workDir] = stdout.replace(/\r/g, '').split('\n').filter(Boolean);
          resolve({ target, args, workDir });
        }
      }
    );
  });
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autostart-test-'));
  const target = process.execPath; // 指向 node.exe，仅验证快捷方式结构
  const args = `"${path.join(dir, 'fake-app')}" --hidden`;
  const workDir = dir;

  console.log('== 开机自启（启动文件夹快捷方式） ==');
  assert.strictEqual(autostart.isEnabled(dir), false, '初始状态应为未启用');
  console.log('  ✓ 初始状态为未启用');

  await autostart.createShortcut({ appDataDir: dir }, { target, args, workDir });
  assert.strictEqual(autostart.isEnabled(dir), true, '创建后应处于启用状态');
  assert.ok(fs.existsSync(autostart.shortcutPath(dir)), '快捷方式文件应存在');
  console.log('  ✓ 创建快捷方式成功');

  const lnk = autostart.shortcutPath(dir);
  const info = await readShortcut(lnk);
  assert.strictEqual(info.target, target, 'TargetPath 应指向目标程序');
  assert.strictEqual(info.args, args, 'Arguments 应包含 --hidden');
  assert.strictEqual(info.workDir, workDir, 'WorkingDirectory 应正确');
  console.log('  ✓ 快捷方式内容正确（Target / Arguments / WorkingDirectory）');

  await autostart.toggle({ appDataDir: dir }, { target, args, workDir }, false);
  assert.strictEqual(autostart.isEnabled(dir), false, '关闭后应处于未启用状态');
  assert.ok(!fs.existsSync(lnk), '快捷方式文件应被删除');
  console.log('  ✓ 关闭自启（删除快捷方式）成功');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('AUTOSTART TESTS PASSED');
}

main().catch((err) => {
  console.error('AUTOSTART TEST FAILED:', err);
  process.exit(1);
});
