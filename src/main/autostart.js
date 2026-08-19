'use strict';

/**
 * 开机自启：在「用户启动文件夹」创建 / 删除快捷方式。
 *   位置：%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ScheduleApp.lnk
 *   方式：PowerShell WScript.Shell COM 创建 .lnk（不写注册表，用户可见易管理）。
 * 注意：本模块禁止 require('electron')，所有路径由调用方传入。
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// 快捷方式文件名必须是 ASCII：en-US 等非中文系统的 WScript.Shell 会把
// 非 ANSI 字符转成 '?' 导致保存失败（FileNotFoundException）。
const SHORTCUT_NAME = 'ScheduleApp.lnk';
const PS_TIMEOUT_MS = 15000;

function startupFolder(appDataDir) {
  return path.join(appDataDir, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

function shortcutPath(appDataDir) {
  return path.join(startupFolder(appDataDir), SHORTCUT_NAME);
}

function isEnabled(appDataDir) {
  return fs.existsSync(shortcutPath(appDataDir));
}

/** PowerShell 单引号字符串转义（' → ''），避免注入与引号问题 */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runPowerShell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: PS_TIMEOUT_MS, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error((stderr || stdout || err.message || '').trim() || '创建快捷方式失败'));
        } else {
          resolve(stdout);
        }
      }
    );
  });
}

/**
 * 创建启动文件夹快捷方式。
 * @param {{appDataDir:string}} paths
 * @param {{target:string, args:string, workDir:string}} targetInfo
 */
async function createShortcut(paths, targetInfo) {
  const lnk = shortcutPath(paths.appDataDir);
  fs.mkdirSync(startupFolder(paths.appDataDir), { recursive: true });
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$ws = New-Object -ComObject WScript.Shell',
    `$sc = $ws.CreateShortcut(${psQuote(lnk)})`,
    `$sc.TargetPath = ${psQuote(targetInfo.target)}`,
    `$sc.Arguments = ${psQuote(targetInfo.args || '')}`,
    `$sc.WorkingDirectory = ${psQuote(targetInfo.workDir || path.dirname(targetInfo.target))}`,
    `$sc.IconLocation = ${psQuote(`${targetInfo.target}, 0`)}`,
    `$sc.Description = 'ScheduleApp'`,
    '$sc.Save()'
  ].join('\n');
  await runPowerShell(script);
  return true;
}

async function removeShortcut(paths) {
  fs.rmSync(shortcutPath(paths.appDataDir), { force: true });
  return true;
}

/** 统一开关：返回设置后的真实状态 */
async function toggle(paths, targetInfo, enabled) {
  if (enabled) {
    await createShortcut(paths, targetInfo);
  } else {
    await removeShortcut(paths);
  }
  return isEnabled(paths.appDataDir);
}

module.exports = { SHORTCUT_NAME, startupFolder, shortcutPath, isEnabled, createShortcut, removeShortcut, toggle };
