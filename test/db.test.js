'use strict';

/**
 * 数据层与重复展开逻辑单测。
 * 运行：npm test（纯 Node，无需 Electron / 图形界面）。
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ScheduleDB } = require('../src/main/db');
const occ = require('../src/main/occurrences');
const { Settings } = require('../src/main/settings');

let passed = 0;
function ok(name, cond) {
  assert(cond, `断言失败：${name}`);
  passed++;
  console.log(`  ✓ ${name}`);
}

const T0 = Date.now();
const DAY = 86400000;

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-test-'));
  const dbPath = path.join(dir, 'test.db');

  console.log('== 重复展开（纯函数） ==');
  let s = { startAt: new Date(2025, 2, 5, 9, 0), endAt: new Date(2025, 2, 5, 10, 0), repeatType: 'none' };
  let r = occ.expandOccurrences(s, new Date(2025, 2, 1), new Date(2025, 2, 31, 23, 59, 59));
  ok('单次日程落在区间内', r.length === 1 && r[0].start.getHours() === 9);
  r = occ.expandOccurrences(s, new Date(2025, 3, 1), new Date(2025, 3, 30));
  ok('单次日程不在区间内', r.length === 0);

  s = { startAt: new Date(2025, 2, 1, 8, 0), endAt: new Date(2025, 2, 1, 9, 0), repeatType: 'daily', repeatInterval: 1, repeatEnd: '2025-03-05' };
  r = occ.expandOccurrences(s, new Date(2025, 1, 1), new Date(2025, 3, 1));
  ok('每天重复按结束日期截断（5 次）', r.length === 5);

  s = { startAt: new Date(2025, 2, 3, 8, 0), endAt: new Date(2025, 2, 3, 9, 0), repeatType: 'weekly', repeatInterval: 2, repeatEnd: null };
  r = occ.expandOccurrences(s, new Date(2025, 2, 1), new Date(2025, 2, 31, 23, 59, 59));
  ok('每两周重复（3/3、3/17、3/31 三次）', r.length === 3 && r.map((o) => o.start.getDate()).join(',') === '3,17,31');

  s = { startAt: new Date(2025, 0, 31, 8, 0), endAt: new Date(2025, 0, 31, 9, 0), repeatType: 'monthly', repeatInterval: 1, repeatEnd: null };
  r = occ.expandOccurrences(s, new Date(2025, 0, 1), new Date(2025, 4, 31, 23, 59, 59));
  ok('每月 31 号：2 月钳制到 28，3 月回到 31', r.map((o) => o.start.getDate()).join(',') === '31,28,31,30,31');

  console.log('== 设置（含数据目录） ==');
  const settingsFile = path.join(dir, 'settings.json');
  let st = new Settings(settingsFile);
  ok('设置默认值（dataDir=null 即 C 盘默认）', st.get().dataDir === null && st.get().notificationsEnabled === true);
  st.set({ dataDir: path.join(dir, 'my-data'), notificationsEnabled: false });
  ok('保存设置', st.get().dataDir === path.join(dir, 'my-data') && st.get().notificationsEnabled === false);
  st.set({ dataDir: null });
  ok('恢复默认数据目录', st.get().dataDir === null);
  assert.throws(() => st.set({ dataDir: 123 }), /数据目录/);
  ok('数据目录类型校验', true);
  const st2 = new Settings(settingsFile);
  ok('设置持久化', st2.get().dataDir === null && st2.get().notificationsEnabled === false);

  console.log('== 分类 CRUD ==');
  const db = await ScheduleDB.open(dbPath);
  const cat1 = db.createCategory({ name: '工作', color: '#4A90D9' });
  const cat2 = db.createCategory({ name: '生活' });
  ok('创建分类（含默认颜色）', cat1.id > 0 && cat2.color === '#4A90D9');
  ok('列出分类', db.listCategories().length === 2);
  db.updateCategory({ id: cat1.id, name: '工作-更新', color: '#E74C3C' });
  ok('更新分类', db.listCategories().find((c) => c.id === cat1.id).name === '工作-更新');
  assert.throws(() => db.createCategory({ name: '' }), /名称不能为空/);
  assert.throws(() => db.createCategory({ name: 'x', color: 'red' }), /颜色/);
  ok('分类输入校验', true);

  console.log('== 日程 CRUD / 查询 / 提醒 ==');
  const startAt = new Date(T0 + 3600 * 1000); // 1 小时后
  const endAt = new Date(T0 + 7200 * 1000);
  const sch = db.createSchedule({ title: '开会', startAt, endAt, categoryId: cat1.id, reminderMinutes: 30, note: '周会' });
  ok('创建日程（分类 + 提醒 + 备注）', sch.id > 0 && sch.reminderMinutes === 30);
  ok('读取日程', db.getSchedule(sch.id).title === '开会' && db.getSchedule(sch.id).categoryId === cat1.id);

  const from = new Date(T0 - 1000);
  const to = new Date(T0 + 3 * DAY);
  let occs = db.queryOccurrences({ from, to });
  ok('区间查询返回发生实例（含分类信息）',
    occs.length === 1 && occs[0].categoryName === '工作-更新' && occs[0].categoryColor === '#E74C3C');
  ok('按分类筛选', db.queryOccurrences({ from, to, categoryId: cat2.id }).length === 0);
  ok('关键词搜索（备注命中）', db.queryOccurrences({ from, to, keyword: '周会' }).length === 1);
  ok('关键词搜索（不命中）', db.queryOccurrences({ from, to, keyword: '不存在xx' }).length === 0);

  // 提醒：提前 30 分钟 → 30 分钟后触发
  ok('提醒未到触发时间', db.dueReminders(new Date(T0 + 29 * 60000)).length === 0);
  let due = db.dueReminders(new Date(T0 + 31 * 60000));
  ok('提醒到点触发', due.length === 1 && due[0].title === '开会');
  db.markNotified(due[0].scheduleId, due[0].fireAtStr);
  ok('提醒触发后不再重复', db.dueReminders(new Date(T0 + 31 * 60000)).length === 0);

  // 修改时间 → 提醒重建（新 fire_at = 5 天后 - 30 分钟）
  db.updateSchedule({
    id: sch.id, title: '开会（改）',
    startAt: new Date(T0 + 5 * DAY), endAt: new Date(T0 + 5 * DAY + 3600 * 1000), reminderMinutes: 30
  });
  ok('更新日程后提醒重建', db.dueReminders(new Date(T0 + 5 * DAY)).length === 1);
  ok('旧提醒时间不再存在', db.dueReminders(new Date(T0 + 31 * 60000)).length === 0);

  // 完成 → 提醒取消；取消完成 → 恢复
  const toWide = new Date(T0 + 6 * DAY); // 日程此时已改到 5 天后，查询区间需覆盖
  db.toggleDone(sch.id, true);
  ok('勾选完成后提醒取消', db.dueReminders(new Date(T0 + 5 * DAY)).length === 0);
  ok('完成后默认不出现在查询中', db.queryOccurrences({ from, to: toWide }).length === 0);
  ok('勾选“显示已完成”后出现', db.queryOccurrences({ from, to: toWide, includeDone: true }).length === 1);
  db.toggleDone(sch.id, false);
  ok('取消完成后提醒恢复', db.dueReminders(new Date(T0 + 5 * DAY)).length === 1);

  // 重复日程：从 3 天后起每天 10 次，提前 15 分钟提醒
  const repStart = new Date(T0 + 3 * DAY);
  repStart.setHours(6, 30, 0, 0);
  const rs = db.createSchedule({
    title: '晨跑',
    startAt: repStart,
    endAt: new Date(repStart.getTime() + 30 * 60000),
    repeatType: 'daily', repeatInterval: 1,
    repeatEnd: occ.dateStr(new Date(repStart.getTime() + 9 * DAY)),
    reminderMinutes: 15, allDay: false
  });
  ok('重复日程区间展开（10 次）',
    db.queryOccurrences({ from: new Date(T0 - 1000), to: new Date(T0 + 30 * DAY), keyword: '晨跑' }).length === 10);
  ok('重复日程提醒尚未到期', db.dueReminders(new Date(T0 + DAY)).every((x) => x.title !== '晨跑'));
  const firstFire = new Date(repStart.getTime() - 15 * 60000);
  due = db.dueReminders(new Date(firstFire.getTime() + 60000));
  ok('重复日程首次提醒到点', due.some((x) => x.title === '晨跑'));

  // 全天日程：提醒固定为当天 09:00
  const alldayDate = new Date(T0 + 2 * DAY);
  alldayDate.setHours(0, 0, 0, 0);
  const ad = db.createSchedule({
    title: '全天活动', allDay: true,
    startAt: alldayDate,
    endAt: new Date(alldayDate.getTime() + DAY - 1000),
    reminderMinutes: 30
  });
  due = db.dueReminders(new Date(alldayDate.getTime() + 9.5 * 3600 * 1000));
  const adDue = due.find((x) => x.title === '全天活动');
  ok('全天日程 09:00 提醒', !!adDue && occ.parseLocal(adDue.fireAtStr).getHours() === 9);

  // 删除分类 → 日程变为无分类
  db.removeCategory(cat1.id);
  ok('删除分类后日程 categoryId 置空', db.getSchedule(sch.id).categoryId === null);

  // 删除日程
  db.removeSchedule(sch.id);
  ok('删除日程', db.getSchedule(sch.id) === null);

  // 输入校验
  assert.throws(() => db.createSchedule({ title: '' }), /标题/);
  assert.throws(() => db.createSchedule({ title: 'x', startAt: endAt, endAt: startAt }), /结束/);
  assert.throws(() => db.createSchedule({ title: 'x', startAt, endAt, repeatType: 'hourly' }), /重复类型/);
  assert.throws(() => db.createSchedule({ title: 'x', startAt, endAt, reminderMinutes: -1 }), /提醒/);
  ok('日程输入校验', true);

  console.log('== 持久化 ==');
  db.save();
  db.close();
  const db2 = await ScheduleDB.open(dbPath);
  ok('重新打开后分类保留', db2.listCategories().length === 1 && db2.listCategories()[0].name === '生活');
  ok('重新打开后日程保留', db2.getSchedule(rs.id) !== null && db2.getSchedule(rs.id).title === '晨跑');
  ok('重新打开后提醒保留', db2.dueReminders(new Date(firstFire.getTime() + 60000)).some((x) => x.title === '晨跑'));
  db2.close();

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\nALL TESTS PASSED（共 ${passed} 项断言）`);
}

main().catch((err) => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});
