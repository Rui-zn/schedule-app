'use strict';

/**
 * 主进程入口：窗口、托盘（后台运行）、IPC、提醒调度循环、开机自启。
 */

const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, shell, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ScheduleDB } = require('./db');
const { Settings } = require('./settings');
const autostart = require('./autostart');

const SMOKE = process.argv.includes('--smoke');     // 冒烟测试模式：初始化数据层后直接退出
const UITEST = process.argv.includes('--uitest');   // UI 自检模式：加载真实页面做端到端 CRUD 校验后退出
const SHOT = process.argv.includes('--shot');       // 截图模式：加载页面后截取主窗口保存到 docs/screenshots/main.png
const HIDDEN = process.argv.includes('--hidden');  // 静默启动（开机自启使用）：只驻留托盘
const CHECK_INTERVAL_MS = 20 * 1000;               // 提醒扫描间隔
const APP_ID = 'com.local.schedule';

let win = null;
let tray = null;
let db = null;
let settings = null;
let isQuitting = false;
let hideHintShown = false;

function userDataDir() {
  return app.getPath('userData');
}

/** 当前数据目录：settings.dataDir 或默认 userData（%APPDATA%\日程表\，即 C 盘） */
function resolvedDataDir() {
  const d = settings.get().dataDir;
  return d ? path.resolve(d) : userDataDir();
}

function dbPathFor() {
  return path.join(resolvedDataDir(), 'schedule.db');
}

/** 关闭旧库并打开当前数据目录下的数据库（切换目录后调用） */
async function openDatabase() {
  if (db) {
    try { db.save(); } catch (_) { /* 保存失败不阻塞切换 */ }
    db.close();
  }
  db = await ScheduleDB.open(dbPathFor());
}

/**
 * 切换数据存放目录。
 * 流程：探测目标目录 → 落盘并关闭旧库 →（可选）复制数据并校验 → 打开新库（失败回退旧库）→ 写配置 → 删旧文件。
 * @param {string|null} dir 目标目录；null = 恢复默认（C 盘 %APPDATA%）
 * @param {boolean} moveExisting 是否把现有 schedule.db 移动到新目录
 * @returns {{dataDir:string, dbPath:string, moved:boolean}}
 */
async function switchDataDir(dir, moveExisting) {
  const targetDir = dir ? path.resolve(String(dir)) : userDataDir();
  const currentDir = resolvedDataDir();
  const sameDir = path.resolve(currentDir).toLowerCase() === path.resolve(targetDir).toLowerCase();

  // 1. 目标目录可写性检查：创建目录并写探测文件
  fs.mkdirSync(targetDir, { recursive: true });
  const probe = path.join(targetDir, `.write-test-${Date.now()}`);
  try {
    fs.writeFileSync(probe, 'ok');
  } finally {
    try { fs.rmSync(probe, { force: true }); } catch (_) { /* 忽略 */ }
  }

  // 2. 落盘并关闭旧库（先关库再动文件，避免后续 save 把被移走的旧文件“复活”）
  if (db) {
    try { db.save(); } catch (_) { /* 保存失败不阻塞切换 */ }
    db.close();
    db = null;
  }

  // 3. 移动现有数据：先复制 + 校验，删除旧文件放到新库打开成功之后
  const src = path.join(currentDir, 'schedule.db');
  const dst = path.join(targetDir, 'schedule.db');
  let copied = false;
  if (!sameDir && moveExisting && fs.existsSync(src) && !fs.existsSync(dst)) {
    // 目标位置已有数据时不覆盖，直接使用目标现有数据
    fs.copyFileSync(src, dst);
    if (fs.statSync(dst).size !== fs.statSync(src).size) {
      fs.rmSync(dst, { force: true });
      db = await ScheduleDB.open(src); // 回退：重新打开旧库
      throw new Error('数据复制失败，未切换目录');
    }
    copied = true;
  }

  // 4. 打开新目录的数据库（失败则回退打开旧库）
  try {
    db = await ScheduleDB.open(path.join(targetDir, 'schedule.db'));
  } catch (err) {
    try { db = await ScheduleDB.open(src); } catch (_) { db = null; }
    throw err;
  }

  // 5. 持久化目录配置
  if (!sameDir) {
    settings.set({ dataDir: dir ? path.resolve(dir) : null });
  }

  // 6. 新库确认可用后，删除旧文件（删除失败只留冗余副本，不影响使用）
  if (copied) {
    try { fs.rmSync(src); } catch (_) { /* 忽略 */ }
  }

  broadcastDataChanged();
  return { dataDir: resolvedDataDir(), dbPath: db.dbPath, moved: copied };
}

// ---------- 窗口 ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 900,
    minHeight: 580,
    title: '日程表',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // 关闭窗口 → 最小化到托盘（后台运行）
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
      if (!hideHintShown) {
        hideHintShown = true;
        try {
          new Notification({ title: '日程表仍在后台运行', body: '点击系统托盘图标可重新打开窗口。' }).show();
        } catch (_) { /* 通知失败不影响流程 */ }
      }
    }
  });

  win.on('closed', () => { win = null; });

  win.once('ready-to-show', () => {
    if (SHOT) {
      win.show(); // 截图模式强制显示，保证 capturePage 可渲染
      return;
    }
    if (!HIDDEN && !UITEST && !settings.get().startMinimized) showWindow();
  });

  if (UITEST) {
    win.webContents.once('did-finish-load', () => setTimeout(runUiTest, 2500));
  }

  if (SHOT) {
    win.webContents.once('did-finish-load', () => setTimeout(runShot, 4000));
  }
}

/** 截图模式：截取主窗口保存为 PNG（用于 README 等文档配图），随后退出 */
async function runShot() {
  const outDir = path.join(__dirname, '..', '..', 'docs', 'screenshots');
  const outFile = path.join(outDir, 'main.png');
  try {
    const image = await win.webContents.capturePage();
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outFile, image.toPNG());
    console.log('SHOT_OK', outFile);
    app.exit(0);
  } catch (err) {
    console.error('SHOT_FAIL', err);
    app.exit(1);
  }
}

/** UI 自检：通过真实渲染层执行一轮「分类 + 日程」端到端 CRUD 并校验 DOM */
async function runUiTest() {
  const script = `(async () => {
    const api = window.scheduleAPI;
    if (!api || typeof api.schedules.query !== 'function') throw new Error('scheduleAPI 未注入');
    const cat = await api.categories.create({ name: 'UITest', color: '#4A90D9' });
    const start = new Date(Date.now() + 3600 * 1000);
    const sch = await api.schedules.create({
      title: 'UITest-日程', startAt: start, endAt: new Date(start.getTime() + 3600 * 1000), categoryId: cat.id
    });
    const list = await api.schedules.query({
      from: new Date(Date.now() - 1000), to: new Date(Date.now() + 3 * 86400000), keyword: 'UITest-日程'
    });
    if (list.length !== 1 || list[0].categoryName !== 'UITest') throw new Error('CRUD 链路失败');
    // 等待 data:changed 广播后列表 DOM 刷新
    await new Promise((resolve) => {
      const t0 = Date.now();
      const timer = setInterval(() => {
        if (document.getElementById('listView').textContent.includes('UITest-日程') || Date.now() - t0 > 4000) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
    const rendered = document.getElementById('listView').textContent.includes('UITest-日程');
    const catPageOk = await (async () => {
      document.querySelector('.nav-btn[data-page="categories"]').click();
      await new Promise((r) => setTimeout(r, 300));
      return document.getElementById('catList').textContent.includes('UITest');
    })();
    await api.schedules.remove(sch.id);
    await api.categories.remove(cat.id);

    // 数据目录切换（移动数据）测试
    const dataDirDiag = await (async () => {
      const diag = {};
      const info1 = await api.app.info();
      const newDir = info1.dataPath + '\\\\uitest-data-sub';
      const sw = await api.data.switchDir(newDir, true); // 切换到子目录并移动数据
      diag.moved = sw.moved;
      diag.newDir = newDir;
      const info2 = await api.app.info();
      diag.dbPath2 = info2.dbPath;
      diag.prefixOk = info2.dbPath.toLowerCase().startsWith(newDir.toLowerCase());
      // 在新目录下建一条数据，然后切回默认并移动回来
      const s2 = await api.schedules.create({
        title: 'UITest2-数据',
        startAt: new Date(Date.now() + 3600 * 1000),
        endAt: new Date(Date.now() + 7200 * 1000)
      });
      const sw2 = await api.data.switchDir(null, true);
      diag.movedBack = sw2.moved;
      const info3 = await api.app.info();
      diag.dbPath3 = info3.dbPath;
      diag.dbPath1 = info1.dbPath;
      const list2 = await api.schedules.query({
        from: new Date(Date.now() - 1000), to: new Date(Date.now() + 3 * 86400000), keyword: 'UITest2-数据'
      });
      diag.found = list2.length;
      await api.schedules.remove(s2.id);
      return diag;
    })();
    const dataDirOk = dataDirDiag.moved && dataDirDiag.prefixOk && dataDirDiag.dbPath3 === dataDirDiag.dbPath1 && dataDirDiag.found === 1;

    return {
      apiOk: true,
      rendered,
      catPageOk,
      dataDirOk,
      dataDirDiag,
      nav: document.querySelectorAll('.nav-btn').length,
      version: document.getElementById('appVersion').textContent
    };
  })()`;
  try {
    const r = await win.webContents.executeJavaScript(script, true);
    const ok = r && r.apiOk && r.rendered && r.catPageOk && r.dataDirOk && r.nav === 3;
    console.log('UITEST_RESULT', JSON.stringify(r));
    console.log(ok ? 'UITEST_OK' : 'UITEST_FAIL');
    app.exit(ok ? 0 : 1);
  } catch (err) {
    console.error('UITEST_ERROR', err);
    app.exit(1);
  }
}

function showWindow() {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------- 托盘 ----------
function createTray() {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'tray.png');
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('日程表');

  const template = [
    { label: '打开日程表', click: () => showWindow() },
    { type: 'separator' },
    ...(app.isPackaged ? [] : [{
      label: '开发者工具',
      click: () => { if (win) win.webContents.openDevTools({ mode: 'detach' }); }
    }]),
    { label: '退出', click: () => { isQuitting = true; app.quit(); } }
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.on('click', () => {
    if (win && win.isVisible()) win.hide();
    else showWindow();
  });
}

// ---------- 提醒调度 ----------
function checkReminders() {
  if (!db || !settings.get().notificationsEnabled) return;
  try {
    const due = db.dueReminders(new Date());
    if (!due.length) return;
    for (const r of due) {
      db.markNotified(r.scheduleId, r.fireAtStr);
      try {
        const n = new Notification({
          title: '日程提醒',
          body: `${r.allDay ? '[全天] ' : ''}${r.title}`
        });
        n.on('click', () => showWindow());
        n.show();
      } catch (err) {
        console.error('[notify]', err);
      }
    }
    db.save();
    broadcastDataChanged();
  } catch (err) {
    console.error('[scheduler]', err);
  }
}

// ---------- IPC ----------
function broadcastDataChanged() {
  if (win && !win.isDestroyed()) win.webContents.send('data:changed');
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return await fn(payload || {});
    } catch (err) {
      console.error(`[ipc:${channel}]`, err);
      throw new Error(err && err.message ? err.message : '操作失败');
    }
  });
}

function autostartTargetInfo() {
  return {
    target: process.execPath,
    args: app.isPackaged ? '--hidden' : `"${app.getAppPath()}" --hidden`,
    workDir: app.isPackaged ? path.dirname(process.execPath) : app.getAppPath()
  };
}

function registerIpc() {
  // 分类
  handle('category:list', () => db.listCategories());
  handle('category:create', (p) => { const r = db.createCategory(p); broadcastDataChanged(); return r; });
  handle('category:update', (p) => { const r = db.updateCategory(p); broadcastDataChanged(); return r; });
  handle('category:remove', (p) => { db.removeCategory(p.id); broadcastDataChanged(); return true; });

  // 日程
  handle('schedule:get', (p) => db.getSchedule(p.id));
  handle('schedule:query', (p) => db.queryOccurrences(p));
  handle('schedule:create', (p) => { const r = db.createSchedule(p); broadcastDataChanged(); return r; });
  handle('schedule:update', (p) => { const r = db.updateSchedule(p); broadcastDataChanged(); return r; });
  handle('schedule:remove', (p) => { db.removeSchedule(p.id); broadcastDataChanged(); return true; });
  handle('schedule:toggleDone', (p) => { const r = db.toggleDone(p.id, !!p.done); broadcastDataChanged(); return r; });

  // 设置 / 自启 / 应用信息
  handle('settings:get', () => settings.get());
  handle('settings:set', (p) => { const r = settings.set(p); broadcastDataChanged(); return r; });
  handle('autostart:status', () => ({
    enabled: autostart.isEnabled(app.getPath('appData')),
    shortcutPath: autostart.shortcutPath(app.getPath('appData'))
  }));
  handle('autostart:toggle', async (p) => {
    const enabled = await autostart.toggle(
      { appDataDir: app.getPath('appData') },
      autostartTargetInfo(),
      !!p.enabled
    );
    return { enabled, shortcutPath: autostart.shortcutPath(app.getPath('appData')) };
  });
  handle('app:info', () => ({
    version: app.getVersion(),
    userDataPath: userDataDir(),
    dataPath: resolvedDataDir(),
    dbPath: db.dbPath,
    isDefaultDataDir: path.resolve(resolvedDataDir()).toLowerCase() === path.resolve(userDataDir()).toLowerCase()
  }));
  handle('app:openDataPath', async () => { await shell.openPath(resolvedDataDir()); return true; });

  // 数据目录
  handle('data:switch', (p) => switchDataDir(p.dir ?? null, !!p.moveExisting));
  handle('data:resetDir', () => switchDataDir(null, true));
  handle('data:chooseDir', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择数据存放目录',
      buttonLabel: '选择此目录',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: resolvedDataDir()
    });
    if (r.canceled || !r.filePaths.length) return null;
    const picked = r.filePaths[0];
    const choice = await dialog.showMessageBox(win, {
      type: 'question',
      title: '数据目录',
      message: '是否把现有日程数据移动到新目录？',
      detail: `新目录：${picked}\n\n「移动现有数据」：把 schedule.db 复制到新目录并删除旧文件；\n「仅切换」：不移动数据，新位置从空开始（若新位置已有数据则直接使用）。`,
      buttons: ['移动现有数据', '仅切换，不移动', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    });
    if (choice.response === 2) return null;
    return switchDataDir(picked, choice.response === 0);
  });
}

// ---------- 启动 ----------
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId(APP_ID);

  app.on('second-instance', () => showWindow());
  app.on('activate', () => showWindow());
  app.on('before-quit', () => {
    isQuitting = true;
    try { if (db) db.save(); } catch (_) { /* 忽略退出时的保存错误 */ }
  });

  app.whenReady().then(async () => {
    // 数据目录覆盖（开发/演示/便携用途）：SCHEDULE_USER_DATA 指向的目录将作为 userData
    if (process.env.SCHEDULE_USER_DATA) {
      app.setPath('userData', path.resolve(process.env.SCHEDULE_USER_DATA));
    }

    if (SMOKE || UITEST) {
      // 测试模式：使用临时数据目录，避免污染真实数据（优先级高于环境变量）
      app.setPath('userData', path.join(os.tmpdir(), `schedule-${SMOKE ? 'smoke' : 'uitest'}-${Date.now()}`));
    }

    settings = new Settings(path.join(userDataDir(), 'settings.json'));
    await openDatabase();
    registerIpc();

    if (SMOKE) {
      // 冒烟测试：验证数据层链路，不创建任何 GUI
      const probe = db.createSchedule({
        title: '冒烟测试',
        startAt: new Date(Date.now() + 3600 * 1000),
        endAt: new Date(Date.now() + 7200 * 1000)
      });
      db.removeSchedule(probe.id);
      console.log('SMOKE_OK');
      app.exit(0);
      return;
    }

    if (UITEST) {
      // UI 自检：只创建窗口（不创建托盘 / 提醒循环），测试结束后自动退出
      createWindow();
      return;
    }

    if (SHOT) {
      // 截图模式：只创建窗口，截图结束后自动退出（数据目录由 SCHEDULE_USER_DATA 指定）
      createWindow();
      return;
    }

    createWindow();
    createTray();

    setInterval(checkReminders, CHECK_INTERVAL_MS);
    setTimeout(checkReminders, 3000); // 启动时补发 24 小时内错过的提醒
  }).catch((err) => {
    console.error('启动失败:', err);
    app.exit(1);
  });
}
