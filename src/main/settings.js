'use strict';

/**
 * 设置读写（userData/settings.json）。
 * 注意：本模块禁止 require('electron')，路径由调用方传入，可用纯 Node 测试。
 */

const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
  startMinimized: false,        // 手动启动时是否直接最小化到托盘
  notificationsEnabled: true,   // 全局提醒开关
  dataDir: null                 // 数据目录（null = 默认 %APPDATA%\日程表\，即 C 盘）
});

const ALLOWED_KEYS = ['startMinimized', 'notificationsEnabled', 'dataDir'];

class Settings {
  constructor(file) {
    this.file = file;
    this.data = { ...DEFAULTS };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = { ...DEFAULTS, ...raw };
        // 数据目录只接受非空字符串，否则视为默认（C 盘）
        if (typeof this.data.dataDir !== 'string' || !this.data.dataDir.trim()) {
          this.data.dataDir = null;
        }
      }
    } catch (err) {
      // 设置文件损坏时回退默认值（不覆盖原文件，下次保存时修复）
      this.data = { ...DEFAULTS };
    }
  }

  get() {
    return { ...this.data };
  }

  set(patch) {
    if ('startMinimized' in patch) this.data.startMinimized = !!patch.startMinimized;
    if ('notificationsEnabled' in patch) this.data.notificationsEnabled = !!patch.notificationsEnabled;
    if ('dataDir' in patch) {
      const v = patch.dataDir;
      if (v === null || v === undefined || v === '') {
        this.data.dataDir = null;
      } else if (typeof v === 'string') {
        this.data.dataDir = v.trim();
      } else {
        throw new Error('数据目录无效');
      }
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    return this.get();
  }
}

module.exports = { Settings, DEFAULTS };
