'use strict';

/**
 * 生成演示数据（用于界面截图 / 演示环境，不污染真实数据）。
 * 用法：node scripts/demo-data.js <目标数据目录>
 * 示例：node scripts/demo-data.js .demo-data && $env:SCHEDULE_USER_DATA=<绝对路径>; npm start
 */

const path = require('path');
const { ScheduleDB } = require('../src/main/db');

const target = process.argv[2];
if (!target) {
  console.error('用法: node scripts/demo-data.js <目标数据目录>');
  process.exit(1);
}

async function main() {
  const db = await ScheduleDB.open(path.join(path.resolve(target), 'schedule.db'));

  const work = db.createCategory({ name: '工作', color: '#4A90D9' });
  const life = db.createCategory({ name: '生活', color: '#50C878' });
  const study = db.createCategory({ name: '学习', color: '#9B59B6' });

  const now = new Date();
  const at = (dayOffset, h, m = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, m, 0, 0);
    return d;
  };

  const schedules = [
    { title: '产品周会', startAt: at(0, 10, 0), endAt: at(0, 11, 0), categoryId: work.id, reminderMinutes: 10, note: '带上本周进展' },
    { title: '晨跑 5 公里', startAt: at(0, 6, 30), endAt: at(0, 7, 15), categoryId: life.id, repeatType: 'daily', reminderMinutes: 15 },
    { title: '英语单词打卡', startAt: at(0, 21, 0), endAt: at(0, 21, 30), categoryId: study.id, repeatType: 'daily' },
    { title: '缴水电费', startAt: at(1, 12, 0), endAt: at(1, 12, 30), categoryId: life.id, reminderMinutes: 60 },
    { title: '技术分享准备', startAt: at(2, 14, 0), endAt: at(2, 16, 0), categoryId: work.id, note: '整理 PPT 与演示' },
    { title: '图书馆还书', startAt: at(3, 15, 0), endAt: at(3, 16, 0), categoryId: study.id },
    { title: '健身房私教课', startAt: at(4, 19, 0), endAt: at(4, 20, 0), categoryId: life.id, repeatType: 'weekly', reminderMinutes: 30 },
    { title: '家庭出游', startAt: at(5, 0, 0), endAt: at(5, 23, 59), categoryId: life.id, allDay: true },
    { title: '项目里程碑评审', startAt: at(6, 9, 30), endAt: at(6, 12, 0), categoryId: work.id, reminderMinutes: 30, note: '会议室 B' },
    { title: '生日聚会', startAt: at(7, 18, 0), endAt: at(7, 22, 0), categoryId: life.id, reminderMinutes: 1440 }
  ];
  for (const s of schedules) db.createSchedule(s);

  const done = db.createSchedule({ title: '整理周报', startAt: at(-1, 17, 0), endAt: at(-1, 18, 0), categoryId: work.id });
  db.toggleDone(done.id, true);

  db.close();
  console.log(`演示数据已生成：${path.join(path.resolve(target), 'schedule.db')}（3 个分类 / ${schedules.length + 1} 条日程）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
