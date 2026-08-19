# 日程表（Schedule App）项目文档

> 本文档面向 **AI 开发 / 后续维护者**，描述项目的目标、架构、数据模型、核心机制与开发约定。
> 版本：v1.0.0 ｜ 状态：首版可用

---

## 1. 项目概述

一个运行在 **Windows 本地** 的日程表桌面应用，用于个人日程管理。

- **形态**：Electron 桌面应用，常驻系统托盘，关闭窗口时后台运行（最小化到托盘）。
- **核心能力**：日程的增删改查（CRUD），外加桌面提醒、重复日程、分类标签、完成状态。
- **启动方式**：手动启动；可开启「开机自启」（在用户启动文件夹创建快捷方式，静默启动到托盘）。
- **界面语言**：中文。

### 1.1 设计目标

| 目标 | 说明 |
| --- | --- |
| 简单可靠 | 无构建步骤、无前端框架、无原生编译依赖，克隆后 `npm install && npm start` 即可运行 |
| 数据自持 | 所有数据存储在用户数据目录（`userData/schedule.db` + `settings.json`），不依赖网络 |
| 可维护 | 数据层 / 逻辑层 / UI 层分离，核心算法为纯函数，可用 Node 直接单测 |
| AI 友好 | 目录清晰、IPC 契约固定、测试命令一条可跑，改动能快速验证 |

---

## 2. 功能清单

### 2.1 本版已实现（P0）

| 模块 | 功能 | 说明 |
| --- | --- | --- |
| 日程 CRUD | 新建 / 查看 / 编辑 / 删除 | 标题必填；支持开始/结束时间、全天 |
| 完成状态 | 勾选完成 / 取消完成 | 已完成的日程置灰并划线；完成后自动取消其提醒 |
| 重复日程 | 每天 / 每周 / 每月 | 支持间隔（如每 2 周）与可选结束日期 |
| 分类标签 | 分类的增删改 | 每类一个颜色；删除分类后日程变为「无分类」 |
| 提醒通知 | 桌面系统通知 | 按日程设置提前 N 分钟提醒；全天日程为当天 09:00 提醒 |
| 视图 | 列表视图 / 月历视图 | 列表按天分组（今天起 30 天）；月历可翻月、点击日期查看/新建 |
| 搜索筛选 | 关键词搜索 + 分类筛选 | 关键词匹配标题与备注 |
| 后台运行 | 关闭窗口最小化到托盘 | 托盘图标：单击显示窗口，右键菜单：打开 / 退出 |
| 开机自启 | 设置页开关 | 在用户启动文件夹创建/删除快捷方式，自启时以 `--hidden` 静默启动 |
| 数据持久化 | SQLite（sql.js） | 每次写操作后落盘 `schedule.db` |
| 数据目录自定义 | 设置页选择存放目录 | 默认 C 盘 `%APPDATA%\日程表\`；可换任意磁盘目录，切换时可选移动现有数据或仅切换，支持一键恢复默认 |

### 2.2 后续可扩展（P1，暂未实现）

- 提醒弹窗内「稍后提醒（贪睡）」
- 优先级、地点、附件
- 数据导入导出（JSON/iCal）、备份与恢复
- 深色模式、自定义主题
- 每周/双周等更多视图、农历
- 多日历 / 多账户

---

## 3. 技术栈与选型理由

| 项目 | 选择 | 理由 |
| --- | --- | --- |
| 运行时 | Electron（最新稳定版） | 桌面应用 + 托盘 + 系统通知 + 开机自启的成熟方案 |
| 数据库 | [sql.js](https://github.com/sql-js/sql.js)（SQLite 编译为 WASM） | 完整 SQLite SQL 能力，**无需原生编译**（避免 node-gyp/VS Build Tools 问题），个人日程数据量下性能充足 |
| 渲染层 | 原生 HTML/CSS/JS（无框架、无构建） | 界面复杂度可控，去掉构建链，任何 AI 维护者改动即生效 |
| 自启 | 用户启动文件夹 `.lnk` 快捷方式 | 用户明确选择；用户可见、易管理、无注册表污染 |
| 打包 | electron-builder（portable 单文件 exe） | 个人工具足够，免安装 |

> 注意：sql.js 将整个数据库加载进内存，每次变更后整体写回文件。个人日程规模（几千条）完全够用；若未来需要高并发多进程写入，应迁移到 `better-sqlite3`（需原生编译）。

---

## 4. 目录结构

```
schedule/
├── package.json              # 依赖、脚本、electron-builder 配置
├── README.md                 # 快速上手（给用户）
├── LICENSE                   # MIT
├── .github/
│   └── workflows/ci.yml      # GitHub Actions：push 测试构建，v* 标签自动发布
├── docs/
│   ├── PROJECT.md            # 本文档（给 AI 开发）
│   ├── screenshots/          # 界面截图（--shot 模式生成）
│   └── release-notes/        # 各版本发布说明归档
├── scripts/
│   └── demo-data.js          # 演示数据生成（截图 / 演示用）
├── assets/
│   ├── icon.png              # 应用/窗口图标（256×256）
│   └── tray.png              # 托盘图标（32×32）
├── src/
│   ├── main/                 # 主进程（Node 环境）
│   │   ├── main.js           # 入口：窗口、托盘、IPC、提醒调度循环
│   │   ├── db.js             # 数据层：sql.js 封装，所有 SQL 在此
│   │   ├── occurrences.js    # 纯函数：重复日程展开、下次发生时间
│   │   ├── settings.js       # 设置读写（userData/settings.json）
│   │   └── autostart.js      # 开机自启：启动文件夹快捷方式管理
│   ├── preload.js            # contextBridge 暴露 window.scheduleAPI
│   └── renderer/             # 渲染层（浏览器环境）
│       ├── index.html
│       ├── styles.css
│       └── app.js
└── test/
    ├── db.test.js            # 数据层 + 重复展开单测（纯 Node 运行，无需 Electron）
    └── autostart.test.js     # 自启快捷方式测试（临时目录，PowerShell COM）
```

### 4.1 进程分工（重要约定）

- **主进程**：唯一读写 SQLite、管理托盘/窗口/通知/自启、运行提醒调度器。所有业务逻辑在此。
- **渲染进程**：只做展示与交互，**不直接碰数据库**，一切数据经 `window.scheduleAPI`（IPC）获取。
- **preload**：唯一桥接层，渲染层能调用的方法 = preload 暴露的方法。

---

## 5. 数据模型（SQLite）

数据库文件：`<数据目录>/schedule.db`。
数据目录默认 = `app.getPath('userData')`（即 `%APPDATA%\日程表\`，C 盘）；用户可在设置页改为任意目录（存于 `settings.dataDir`，见 6.5）。**settings.json 始终留在 userData**，保证任何情况下都能读回配置。

```sql
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
  start_at         TEXT NOT NULL,          -- 本地时间 'YYYY-MM-DDTHH:mm:ss'（无时区后缀）
  end_at           TEXT NOT NULL,
  all_day          INTEGER NOT NULL DEFAULT 0,
  category_id      INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  repeat_type      TEXT NOT NULL DEFAULT 'none',   -- none | daily | weekly | monthly
  repeat_interval  INTEGER NOT NULL DEFAULT 1,     -- 间隔（如每周=7*interval 天）
  repeat_end       TEXT,                           -- 结束日期 'YYYY-MM-DD' 或 NULL=无限
  reminder_minutes INTEGER,                        -- 提前 N 分钟提醒；NULL=不提醒
  note             TEXT NOT NULL DEFAULT '',
  done             INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  fire_at     TEXT NOT NULL,              -- 本地时间，触发提醒的时刻
  notified    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (schedule_id, fire_at)
);

CREATE INDEX IF NOT EXISTS idx_reminders_fire ON reminders(fire_at, notified);
```

### 5.1 时间约定

- 所有时间字段存 **本地朴素时间字符串** `YYYY-MM-DDTHH:mm:ss`（不带 `Z`），JS 中 `new Date(str)` 即按本地时区解析，避免时区换算带来的显示漂移。
- 全天日程：`start_at = 当天 00:00:00`，`end_at = 当天 23:59:59`（或结束日），UI 只显示日期。
- `repeat_end` 存日期 `YYYY-MM-DD`，重复的结束判定为该日 23:59:59。

---

## 6. 核心机制

### 6.1 重复日程展开（`occurrences.js`，纯函数）

- 输入：日程行 + 查询区间 `[from, to]`；输出：该区间内所有**发生实例** `[{start: Date, end: Date, allDay}]`。
- 规则：
  - `none`：`start_at` 与区间相交则返回一次。
  - `daily`：每次 +`repeat_interval` 天；`weekly`：+`7 * repeat_interval` 天；`monthly`：+`repeat_interval` 个月（**月末钳制**：31 号的下月发生日为下月最后一天）。
  - 单次查询最多生成 5000 个实例（防无限循环）。
- 两处复用：① 列表/月历的区间查询；② 提醒生成。

### 6.2 提醒调度（主进程定时循环）

1. **生成**：日程创建/修改/删除/勾选完成时，主进程调用 `db.rebuildReminders(schedule)`：
   - 先删除该日程全部 `reminders` 行；
   - 若 `reminder_minutes != null` 且未完成，对每个发生实例计算 `fire_at = start - reminder_minutes`（全天日程固定为发生日 **09:00**）；
   - 只保留 `fire_at >= 现在 - 24 小时` 的行（供启动补发），上限 1000 行。
2. **触发**：主进程每 **20 秒** 扫描 `fire_at <= now AND notified = 0` 的行（且日程未完成、全局提醒开关开启），逐条弹出系统通知并置 `notified = 1`。
3. **补发**：应用启动时立即扫描一次，将过去 24 小时内漏发的提醒补发（例如关机期间错过的）。
4. **取消**：日程删除（级联删除）、勾选完成（删除其提醒行）、修改时间（重建）。

### 6.3 开机自启（`autostart.js`）

- **位置**：`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ScheduleApp.lnk`（当前用户启动文件夹）。
- **文件名必须为 ASCII**：en-US 等非中文系统上，WScript.Shell 会把非 ANSI 字符转成 `?`，导致快捷方式保存失败（CI 实测发现）。
- **开启**：用 PowerShell `WScript.Shell` COM 创建快捷方式：
  - 打包版：目标 `process.execPath`，参数 `--hidden`；
  - 开发版：目标 `electron.exe`，参数 `<应用目录> --hidden`（方便调试自启流程）。
- **关闭**：删除该 `.lnk` 文件。
- **状态**：以快捷方式文件是否存在为准（不信任任何缓存值）。
- **静默启动**：主进程检测 `--hidden` 参数 → 不显示窗口，仅驻留托盘。

### 6.4 后台运行 / 托盘

- 窗口 `close` 事件：若非真正退出，`preventDefault()` 并隐藏窗口（首次提示已最小化到托盘）。
- 托盘图标：单击切换窗口显示/隐藏；右键菜单：`打开日程表` / `退出`（退出走 `app.isQuitting` 标志，确保窗口真的关闭）。
- 单实例锁：二次启动时聚焦已有窗口而非新开进程。

### 6.5 设置（`settings.json`，始终位于 userData）

```json
{
  "startMinimized": false,       // 手动启动时是否直接最小化到托盘
  "notificationsEnabled": true,  // 全局提醒开关
  "dataDir": null                // 数据目录；null = 默认 C 盘 %APPDATA%\日程表\
}
```

开机自启状态不落盘，每次实时探测快捷方式。

### 6.6 数据目录切换（`main.js` 的 `switchDataDir`）

- **位置**：只移动 `schedule.db`；`settings.json` 始终留在 userData（避免「找不到配置」的自举问题）。
- **切换流程**：① 目标目录可写性探测（创建 + 写临时文件）→ ② 落盘并**关闭旧库**（先关库再动文件，防止 save 把被移走的旧文件写回来）→ ③ 可选移动：把旧 `schedule.db` 复制到新目录并校验大小（**目标已有数据库时不覆盖，直接使用目标数据**）→ ④ 打开新库（失败自动回退打开旧库）→ ⑤ 写 `settings.dataDir` → ⑥ 新库确认可用后删除旧文件 → ⑦ 广播 `data:changed`。
- **失败回滚**：复制/打开任一步失败则旧文件保留、旧库重新打开、配置不变。
- **恢复默认**：`data:resetDir` 以「移动数据」方式切回 userData。
- UI 入口：设置页「选择目录…」弹系统目录选择框，再弹确认框三选一（移动现有数据 / 仅切换 / 取消）。

---

## 7. IPC 契约（渲染层 ↔ 主进程）

全部通过 `ipcRenderer.invoke`（渲染层调 `window.scheduleAPI.*`），主进程校验并返回 **plain object**（Date 可经结构化克隆传递）。失败时 reject 并携带中文错误信息，渲染层 toast 展示。

### 7.1 分类

| API | 参数 | 返回 |
| --- | --- | --- |
| `categories.list()` | - | `[{id, name, color, sort, createdAt}]` |
| `categories.create()` | `{name, color}` | 新分类对象 |
| `categories.update()` | `{id, name?, color?}` | 更新后对象 |
| `categories.remove()` | `{id}` | `true`（日程的 category_id 自动置 NULL） |

### 7.2 日程

| API | 参数 | 返回 |
| --- | --- | --- |
| `schedules.get()` | `{id}` | 单条日程原始行（编辑弹窗使用）：`{id, title, startAt: Date, endAt: Date, allDay, categoryId, repeatType, repeatInterval, repeatEnd, reminderMinutes, note, done, createdAt, updatedAt}` |
| `schedules.query()` | `{from: Date, to: Date, keyword?, categoryId?, includeDone?}` | 区间内**发生实例**数组：`{scheduleId, title, start: Date, end: Date, allDay, done, categoryId, categoryName, categoryColor, note, repeatType, reminderMinutes}` |
| `schedules.create()` | `{title, startAt, endAt, allDay, categoryId, repeatType, repeatInterval, repeatEnd, reminderMinutes, note}` | 新日程行 |
| `schedules.update()` | 同上 + `{id}` | 更新后行 |
| `schedules.remove()` | `{id}` | `true` |
| `schedules.toggleDone()` | `{id, done}` | 更新后行 |

### 7.3 应用 / 设置 / 自启

| API | 参数 | 返回 |
| --- | --- | --- |
| `settings.get()` | - | `{startMinimized, notificationsEnabled, dataDir}` |
| `settings.set()` | `{startMinimized?, notificationsEnabled?, dataDir?}` | 保存后对象 |
| `autostart.status()` | - | `{enabled, shortcutPath}` |
| `autostart.toggle()` | `{enabled}` | `{enabled, shortcutPath}` |
| `app.info()` | - | `{version, userDataPath, dataPath, dbPath, isDefaultDataDir}`（dataPath=当前数据目录，dbPath=当前数据库文件） |
| `app.openDataPath()` | - | 打开当前数据目录 |
| `data.chooseDir()` | - | 弹目录选择框 + 移动确认框；取消返回 `null`，成功返回 `{dataDir, dbPath, moved}` |
| `data.switchDir()` | `{dir: string\|null, moveExisting: boolean}` | 直接切换（chooseDir 的底层实现，也供 UI 自检使用），返回 `{dataDir, dbPath, moved}` |
| `data.resetDir()` | - | 恢复默认 C 盘目录并移动数据，返回 `{dataDir, dbPath, moved}` |

### 7.4 事件（主进程 → 渲染层）

- `data:changed`：任何写操作成功后广播，渲染层收到后刷新当前视图与分类列表。

---

## 8. 开发与运行

### 8.1 环境要求

- Windows 10/11
- Node.js ≥ 20（开发机已验证 v24.14.0）
- 无需任何原生编译工具链

### 8.2 常用命令

```bash
npm install            # 安装依赖
npm start              # 启动应用（显示窗口）
npm run start:hidden   # 静默启动（仅托盘，模拟自启）
npm test               # 数据层 + 自启模块测试（纯 Node，无 Electron）
npm run test:ui        # UI 自检：真实页面端到端 CRUD + DOM 校验（自动退出）
npm run dist           # 打包 portable exe（输出 dist/）
```

### 8.3 特殊启动参数 / 环境变量（测试与文档配图）

| 方式 | 作用 |
| --- | --- |
| `electron . --smoke` | 冒烟测试：初始化数据层后退出（不建 GUI） |
| `electron . --uitest` | UI 自检：真实页面端到端 CRUD + 目录切换校验后退出 |
| `electron . --shot` | 截图模式：加载页面 4 秒后截取主窗口 → `docs/screenshots/main.png`，自动退出 |
| `SCHEDULE_USER_DATA=<目录>` | 覆盖 userData（演示/截图/便携用途），优先级低于 `--smoke`/`--uitest` 的临时目录 |

生成演示数据并截图：

```bash
node scripts/demo-data.js .demo-data        # 生成演示数据
$env:SCHEDULE_USER_DATA="<绝对路径>\.demo-data"; npx electron . --shot
```

### 8.4 持续集成 / 自动发布（GitHub Actions）

`.github/workflows/ci.yml`（windows-latest）：

1. **push 到 `main` / PR**：`npm ci` → `npm test` → `npm run test:ui` → `npm run dist`，exe 重命名为 `ScheduleApp-<version>-portable.exe` 后上传 Artifact（保留 7 天）。
2. **推送 `v*` 标签**：上述流程 + `softprops/action-gh-release` 自动创建 Release 并附带 exe（`generate_release_notes` 自动生成说明）。

**发版约定**：先把 `package.json` 与 `package-lock.json` 的 `version` 同步升号并提交，再 `git tag v<版本> && git push origin v<版本>`。若需自定义发布说明，在 `docs/release-notes/v<版本>.md` 写好并在 workflow 里切换为 `body_path`。

> 提示：`test/db.test.js` 覆盖重复展开与数据层；`test/autostart.test.js` 在**临时目录**里创建/读取/删除启动文件夹快捷方式（不会碰真实启动文件夹）；`--smoke` / `--uitest` 两个启动参数使用临时 userData，不会污染真实数据。国内网络下载 Electron 慢时可设置镜像：`$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'`。

### 8.3 调试

- 主进程日志：`npm start` 后终端可见；渲染层 F12 开发者工具。
- 数据文件位置：`%APPDATA%\日程表\schedule.db`（打包版）/ Electron 默认 userData（开发版），可在「设置」页查看实际路径。

---

## 9. 给 AI 开发的约定（重要）

1. **改 SQL 只改 `src/main/db.js`**；改重复逻辑只改 `src/main/occurrences.js`；改 UI 只改 `src/renderer/`。
2. 新加渲染层能力必须：`preload.js` 暴露 → `main.js` 注册 handler → `app.js` 调用，三步缺一不可。
3. `db.js` 与 `occurrences.js` **禁止 require('electron')**，保持可用纯 Node 测试（`npm test`）。
4. 每次改动后至少跑 `npm test`；涉及 IPC/UI 的改动需 `npm start` 人工验证。
5. 时间一律走「本地朴素字符串」约定（见 5.1），不要引入 UTC 换算。
6. 写操作完成后必须调用 `db.save()` 落盘并广播 `data:changed`。
7. 自启快捷方式只允许放在「用户启动文件夹」，不要改注册表/计划任务。

---

## 10. 已知限制

- 提醒依赖应用进程存活；若退出应用，期间提醒在下次启动时补发（24 小时内）。
- 重复日程的「下次发生时间」在修改历史实例时不回溯（本版不支持修改单次实例）。
- 月历视图每格最多展示 3 条，其余以「+N」折叠。
- sql.js 全量落盘，万级数据时写盘约数十毫秒，个人使用无感。
- 切换数据目录时目标目录**已有** `schedule.db` 则直接使用目标数据、不覆盖不合并；「仅切换」模式旧数据留在原目录，需自行处理。
