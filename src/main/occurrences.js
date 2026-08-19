'use strict';

/**
 * 重复日程展开（纯函数模块）。
 * 注意：本模块禁止 require('electron')，保证可用纯 Node 单测（npm test）。
 * 时间语义：全部使用本地时区的 Date 对象。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_OCCURRENCES = 5000;      // 单次展开实例数上限（防死循环）
const MAX_FAST_FORWARD_STEPS = 10000;

function pad(n) { return String(n).padStart(2, '0'); }

/** 解析本地朴素时间/日期字符串（'YYYY-MM-DDTHH:mm:ss' 或 'YYYY-MM-DD'），失败返回 null */
function parseLocal(s) {
  if (typeof s !== 'string' || !s) return null;
  const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date → 'YYYY-MM-DD'（本地） */
function dateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 加 months 个月；日号锚定 anchorDay，超过目标月天数时钳制到月末。
 * 例：锚定 31 号 → 1/31、2/28、3/31、4/30 …
 */
function addMonthsClamped(d, months, anchorDay) {
  const y = d.getFullYear();
  const m = d.getMonth() + months;
  const last = new Date(y, m + 1, 0).getDate();
  const dd = Math.min(anchorDay, last);
  return new Date(y, m, dd, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}

/** 下一个发生实例；返回 null 表示无法推进 */
function nextOccurrence(start, repeatType, interval, baseDay) {
  switch (repeatType) {
    case 'daily': return new Date(start.getTime() + interval * DAY_MS);
    case 'weekly': return new Date(start.getTime() + interval * 7 * DAY_MS);
    case 'monthly': return addMonthsClamped(start, interval, baseDay);
    default: return null;
  }
}

/**
 * 快进到不超过 target 的最近发生实例附近，
 * 避免「3 年前创建的每日重复」从远古逐次迭代导致撞上实例数上限。
 */
function fastForward(baseStart, repeatType, interval, baseDay, target) {
  const startMs = baseStart.getTime();
  if (startMs >= target) return new Date(startMs);
  if (repeatType === 'daily' || repeatType === 'weekly') {
    const span = (repeatType === 'daily' ? interval : interval * 7) * DAY_MS;
    const k = Math.floor((target - startMs) / span);
    return new Date(startMs + k * span);
  }
  // monthly：逐月推进（多年也仅几百次迭代）
  let cur = new Date(startMs);
  let steps = 0;
  while (cur.getTime() < target && steps < MAX_FAST_FORWARD_STEPS) {
    cur = nextOccurrence(cur, 'monthly', interval, baseDay);
    steps++;
  }
  return cur;
}

/**
 * 展开日程在 [from, to] 区间内的所有发生实例（按 start 升序）。
 * @param {{startAt:Date, endAt:Date, allDay?:boolean, repeatType?:string, repeatInterval?:number, repeatEnd?:string|null}} schedule
 * @param {Date} from 区间开始
 * @param {Date} to   区间结束
 * @returns {{start:Date, end:Date}[]}
 */
function expandOccurrences(schedule, from, to) {
  const startAt = schedule.startAt;
  const endAt = schedule.endAt;
  const repeatType = schedule.repeatType || 'none';
  const interval = Math.max(1, Math.floor(schedule.repeatInterval || 1));
  const repeatEnd = schedule.repeatEnd || null;
  const duration = endAt.getTime() - startAt.getTime();
  const out = [];

  // 单次日程：区间相交即返回
  if (repeatType === 'none') {
    if (startAt.getTime() < to.getTime() && endAt.getTime() > from.getTime()) {
      out.push({ start: startAt, end: endAt });
    }
    return out;
  }

  // repeatEnd 当日的 23:59:59 为重复截止
  const endLimit = repeatEnd ? (parseLocal(repeatEnd) || endAt).getTime() + DAY_MS - 1000 : null;
  const baseDay = startAt.getDate();

  // 快进到区间起点之前（保证一个合理的迭代步数即可覆盖区间）
  let occStart = fastForward(startAt, repeatType, interval, baseDay, from.getTime() - duration - DAY_MS);

  let count = 0;
  while (count < MAX_OCCURRENCES) {
    const occEnd = new Date(occStart.getTime() + duration);
    if (endLimit !== null && occStart.getTime() > endLimit) break;
    if (occStart.getTime() < to.getTime() && occEnd.getTime() > from.getTime()) {
      out.push({ start: occStart, end: occEnd });
    }
    if (occStart.getTime() >= to.getTime()) break; // 实例升序，越过区间末尾即可结束
    const next = nextOccurrence(occStart, repeatType, interval, baseDay);
    if (!next || next.getTime() <= occStart.getTime()) break; // 防死循环
    occStart = next;
    count++;
  }
  return out;
}

module.exports = {
  DAY_MS,
  MAX_OCCURRENCES,
  parseLocal,
  dateStr,
  addMonthsClamped,
  nextOccurrence,
  expandOccurrences
};
