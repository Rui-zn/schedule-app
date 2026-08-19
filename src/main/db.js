'use strict';

/**
 * 数据层：sql.js（SQLite → WASM）封装，主进程唯一的数据入口。
 * 注意：本模块禁止 require('electron')，保证可用纯 Node 单测（npm test）。
 * 时间约定：所有时间字段存本地朴素字符串 'YYYY-MM-DDTHH:mm:ss'（不带时区后缀）。
 * 写操作后必须调用 save() 落盘。
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const occ = require('./occurrences');

const REPEAT_TYPES = ['none', 'daily', 'weekly', 'monthly'];
const MAX_REMINDERS_PER_SCHEDULE = 1000;

function pad(n) { return String(n).padStart(2, '0'); }

/** Date → 本地朴素时间字符串 */
function fmtLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#4A90D9',
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT NOT NULL,
  start_at         TEXT NOT NULL,
  end_at           TEXT NOT NULL,
  all_day          INTEGER NOT NULL DEFAULT 0,
  category_id      INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  repeat_type      TEXT NOT NULL DEFAULT 'none',
  repeat_interval  INTEGER NOT NULL DEFAULT 1,
  repeat_end       TEXT,
  reminder_minutes INTEGER,
  note             TEXT NOT NULL DEFAULT '',
  done             INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  fire_at     TEXT NOT NULL,
  notified    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (schedule_id, fire_at)
);

CREATE INDEX IF NOT EXISTS idx_reminders_fire ON reminders(fire_at, notified);
`;

/** 数据库行 → JS 对象（时间转 Date） */
function rowToJs(row) {
  return {
    id: row.id,
    title: row.title,
    startAt: occ.parseLocal(row.start_at),
    endAt: occ.parseLocal(row.end_at),
    allDay: !!row.all_day,
    categoryId: row.category_id == null ? null : row.category_id,
    repeatType: row.repeat_type || 'none',
    repeatInterval: row.repeat_interval || 1,
    repeatEnd: row.repeat_end || null,
    reminderMinutes: row.reminder_minutes == null ? null : row.reminder_minutes,
    note: row.note || '',
    done: !!row.done,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

class ScheduleDB {
  constructor(dbPath, SQL, database) {
    this.dbPath = dbPath;
    this.SQL = SQL;
    this.db = database;
  }

  /**
   * 打开（或创建）数据库。
   * @param {string} dbPath 数据库文件路径
   */
  static async open(dbPath) {
    const SQL = await initSqlJs({
      locateFile: (f) => path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', f)
    });
    let database;
    if (fs.existsSync(dbPath)) {
      try {
        database = new SQL.Database(fs.readFileSync(dbPath));
      } catch (err) {
        // 数据文件损坏：备份后重建空库
        const bak = `${dbPath}.broken-${Date.now()}`;
        try { fs.copyFileSync(dbPath, bak); } catch (_) { /* 备份失败不阻塞 */ }
        database = new SQL.Database();
      }
    } else {
      database = new SQL.Database();
    }
    const inst = new ScheduleDB(dbPath, SQL, database);
    inst.db.run('PRAGMA foreign_keys = ON');
    inst.db.run(SCHEMA);
    return inst;
  }

  /** 全量落盘 */
  save() {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    fs.writeFileSync(this.dbPath, Buffer.from(this.db.export()));
  }

  close() {
    this.db.close();
  }

  // ---------- 内部工具 ----------
  _run(sql, params = []) {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      while (stmt.step()) { /* drain */ }
    } finally {
      stmt.free();
    }
  }

  _all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    const rows = [];
    try {
      stmt.bind(params);
      while (stmt.step()) rows.push(stmt.getAsObject());
    } finally {
      stmt.free();
    }
    return rows;
  }

  _get(sql, params = []) {
    return this._all(sql, params)[0] || null;
  }

  // ---------- 分类 ----------
  listCategories() {
    return this._all('SELECT id, name, color, sort, created_at AS createdAt FROM categories ORDER BY sort ASC, id ASC');
  }

  createCategory({ name, color = '#4A90D9' } = {}) {
    name = (name || '').trim();
    if (!name) throw new Error('分类名称不能为空');
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('颜色格式不正确');
    this._run('INSERT INTO categories (name, color, sort, created_at) VALUES (?,?,?,?)', [name, color, 0, fmtLocal(new Date())]);
    const id = this._get('SELECT last_insert_rowid() AS id').id;
    this.save();
    return this._get('SELECT id, name, color, sort, created_at AS createdAt FROM categories WHERE id=?', [id]);
  }

  updateCategory({ id, name, color } = {}) {
    const cur = this._get('SELECT * FROM categories WHERE id=?', [id]);
    if (!cur) throw new Error('分类不存在');
    const newName = name != null ? String(name).trim() : cur.name;
    const newColor = color != null ? color : cur.color;
    if (!newName) throw new Error('分类名称不能为空');
    if (!/^#[0-9a-fA-F]{6}$/.test(newColor)) throw new Error('颜色格式不正确');
    this._run('UPDATE categories SET name=?, color=? WHERE id=?', [newName, newColor, id]);
    this.save();
    return this._get('SELECT id, name, color, sort, created_at AS createdAt FROM categories WHERE id=?', [id]);
  }

  removeCategory(id) {
    this._run('DELETE FROM categories WHERE id=?', [id]); // 日程的 category_id 由 ON DELETE SET NULL 置空
    this.save();
    return true;
  }

  // ---------- 日程 ----------
  _validateSchedule(d = {}) {
    const title = (d.title || '').trim();
    if (!title) throw new Error('标题不能为空');
    const startAt = d.startAt instanceof Date ? d.startAt : occ.parseLocal(d.startAt);
    const endAt = d.endAt instanceof Date ? d.endAt : occ.parseLocal(d.endAt);
    if (!startAt || !endAt || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new Error('时间无效');
    }
    if (endAt.getTime() < startAt.getTime()) throw new Error('结束时间不能早于开始时间');

    const repeatType = d.repeatType || 'none';
    if (!REPEAT_TYPES.includes(repeatType)) throw new Error('重复类型无效');
    const repeatInterval = Math.floor(Number(d.repeatInterval) || 1);
    if (repeatInterval < 1 || repeatInterval > 365) throw new Error('重复间隔无效（1-365）');

    const repeatEnd = d.repeatEnd ? String(d.repeatEnd) : null;
    if (repeatEnd !== null && !/^\d{4}-\d{2}-\d{2}$/.test(repeatEnd)) throw new Error('重复结束日期格式不正确');
    if (repeatEnd !== null && repeatType === 'none') throw new Error('不重复的日程无需结束日期');

    let reminderMinutes = d.reminderMinutes == null || d.reminderMinutes === '' ? null : Math.floor(Number(d.reminderMinutes));
    if (reminderMinutes !== null && (Number.isNaN(reminderMinutes) || reminderMinutes < 0 || reminderMinutes > 10080)) {
      throw new Error('提醒时间无效');
    }

    let categoryId = d.categoryId == null || d.categoryId === '' ? null : Number(d.categoryId);
    if (categoryId !== null && !this._get('SELECT id FROM categories WHERE id=?', [categoryId])) {
      throw new Error('所选分类不存在');
    }
    return { title, startAt, endAt, allDay: !!d.allDay, categoryId, repeatType, repeatInterval, repeatEnd, reminderMinutes, note: d.note || '' };
  }

  createSchedule(data) {
    const f = this._validateSchedule(data);
    this._run(
      `INSERT INTO schedules
         (title, start_at, end_at, all_day, category_id, repeat_type, repeat_interval, repeat_end, reminder_minutes, note, done, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?)`,
      [f.title, fmtLocal(f.startAt), fmtLocal(f.endAt), f.allDay ? 1 : 0, f.categoryId,
       f.repeatType, f.repeatInterval, f.repeatEnd, f.reminderMinutes, f.note,
       fmtLocal(new Date()), fmtLocal(new Date())]
    );
    const id = this._get('SELECT last_insert_rowid() AS id').id;
    const row = this.getSchedule(id);
    this.rebuildReminders(row);
    this.save();
    return row;
  }

  getSchedule(id) {
    const row = this._get('SELECT * FROM schedules WHERE id=?', [id]);
    return row ? rowToJs(row) : null;
  }

  updateSchedule({ id, ...data } = {}) {
    if (!this._get('SELECT id FROM schedules WHERE id=?', [id])) throw new Error('日程不存在');
    const f = this._validateSchedule(data);
    this._run(
      `UPDATE schedules SET
         title=?, start_at=?, end_at=?, all_day=?, category_id=?, repeat_type=?, repeat_interval=?, repeat_end=?, reminder_minutes=?, note=?, updated_at=?
       WHERE id=?`,
      [f.title, fmtLocal(f.startAt), fmtLocal(f.endAt), f.allDay ? 1 : 0, f.categoryId,
       f.repeatType, f.repeatInterval, f.repeatEnd, f.reminderMinutes, f.note,
       fmtLocal(new Date()), id]
    );
    const row = this.getSchedule(id);
    this.rebuildReminders(row);
    this.save();
    return row;
  }

  removeSchedule(id) {
    this._run('DELETE FROM schedules WHERE id=?', [id]); // 提醒行级联删除
    this.save();
    return true;
  }

  toggleDone(id, done) {
    if (!this._get('SELECT id FROM schedules WHERE id=?', [id])) throw new Error('日程不存在');
    this._run('UPDATE schedules SET done=?, updated_at=? WHERE id=?', [done ? 1 : 0, fmtLocal(new Date()), id]);
    const row = this.getSchedule(id);
    this.rebuildReminders(row); // 完成 → 取消提醒；取消完成 → 恢复提醒
    this.save();
    return row;
  }

  /**
   * 区间查询：返回 [from, to] 内所有发生实例（重复日程已展开）。
   * @param {{from:Date|string, to:Date|string, keyword?:string, categoryId?:number, includeDone?:boolean}} params
   */
  queryOccurrences(params = {}) {
    const from = params.from instanceof Date ? params.from : occ.parseLocal(params.from);
    const to = params.to instanceof Date ? params.to : occ.parseLocal(params.to);
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new Error('查询区间无效');
    }

    const sqlParts = [
      'SELECT s.*, c.name AS category_name, c.color AS category_color',
      'FROM schedules s LEFT JOIN categories c ON c.id = s.category_id',
      'WHERE 1=1'
    ];
    const sqlParams = [];
    if (params.keyword) {
      sqlParts.push('AND (s.title LIKE ? OR s.note LIKE ?)');
      const k = `%${String(params.keyword).trim()}%`;
      sqlParams.push(k, k);
    }
    if (params.categoryId != null && params.categoryId !== '') {
      sqlParts.push('AND s.category_id = ?');
      sqlParams.push(Number(params.categoryId));
    }
    if (!params.includeDone) sqlParts.push('AND s.done = 0');

    const rows = this._all(sqlParts.join(' '), sqlParams);
    const result = [];
    for (const r of rows) {
      const js = rowToJs(r);
      for (const o of occ.expandOccurrences(js, from, to)) {
        result.push({
          scheduleId: js.id,
          title: js.title,
          start: o.start,
          end: o.end,
          allDay: js.allDay,
          done: js.done,
          categoryId: js.categoryId,
          categoryName: r.category_name || null,
          categoryColor: r.category_color || null,
          note: js.note,
          repeatType: js.repeatType,
          reminderMinutes: js.reminderMinutes
        });
      }
    }
    result.sort((a, b) => a.start.getTime() - b.start.getTime());
    return result;
  }

  // ---------- 提醒 ----------
  /**
   * 重建某日程的全部提醒行（创建/修改/删除/勾选完成后调用）。
   * 规则：fire_at = 开始时间 - reminder_minutes；全天日程固定为发生日 09:00。
   * 只保留 fire_at >= now - 24h 的行（供启动时补发），上限 1000 行。
   */
  rebuildReminders(jsRow) {
    this._run('DELETE FROM reminders WHERE schedule_id=?', [jsRow.id]);
    if (jsRow.done || jsRow.reminderMinutes == null) return;

    const now = Date.now();
    const from = new Date(now - occ.DAY_MS);
    let to;
    if (jsRow.repeatType === 'none') {
      to = new Date(jsRow.startAt.getTime() + 1000);
    } else if (jsRow.repeatEnd) {
      to = new Date(occ.parseLocal(jsRow.repeatEnd).getTime() + occ.DAY_MS - 1000);
    } else {
      to = new Date(now + 365 * occ.DAY_MS);
    }

    const occurrences = occ.expandOccurrences(jsRow, from, to);
    let inserted = 0;
    for (const o of occurrences) {
      const fireAt = jsRow.allDay
        ? new Date(o.start.getFullYear(), o.start.getMonth(), o.start.getDate(), 9, 0, 0)
        : new Date(o.start.getTime() - jsRow.reminderMinutes * 60000);
      if (fireAt.getTime() < now - occ.DAY_MS) continue;
      this._run('INSERT OR REPLACE INTO reminders (schedule_id, fire_at, notified) VALUES (?,?,0)',
        [jsRow.id, fmtLocal(fireAt)]);
      if (++inserted >= MAX_REMINDERS_PER_SCHEDULE) break;
    }
  }

  /** 到期未通知的提醒（fire_at <= now 且日程未完成） */
  dueReminders(now = new Date()) {
    return this._all(
      `SELECT r.schedule_id AS scheduleId, r.fire_at AS fireAtStr, s.title, s.all_day AS allDay
       FROM reminders r JOIN schedules s ON s.id = r.schedule_id
       WHERE r.notified = 0 AND r.fire_at <= ? AND s.done = 0
       ORDER BY r.fire_at ASC`,
      [fmtLocal(now)]
    );
  }

  markNotified(scheduleId, fireAtStr) {
    this._run('UPDATE reminders SET notified=1 WHERE schedule_id=? AND fire_at=?', [scheduleId, fireAtStr]);
  }
}

module.exports = { ScheduleDB };
