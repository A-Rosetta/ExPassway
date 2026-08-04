# ExPassway 网页设计规范

> - 规范版本：1.0
> - 快照基准：`main` / `e7a01cceeefdf6353dfdcdf6421051de191b3c47`
> - 基准日期：2026-08-04（Asia/Shanghai）
> - 适用产品：A-Level Smart Practice / ExPassway
> - 设计主题：Meadow Green（浅色新拟态 + 暗色玻璃拟态）

## 0. 规范地位与关键词

本文档是 ExPassway 新页面、现有页面视觉修改和组件新增时的唯一设计规范入口。目标不是描述一种大致相似的风格，而是让后续实现继续复用当前代码中的设计令牌、材质、组件结构和交互状态，避免页面之间出现颜色、阴影、圆角、排版或行为漂移。

本文使用以下规范性关键词：

- **必须**：任何新实现都要满足；不满足即视为设计回归。
- **禁止**：不得使用；确有业务原因时必须先修改本规范并说明例外。
- **应当**：默认做法；只有明确的可用性或业务约束才能偏离。
- **可以**：已批准但非强制的选择。

如果文档、旧截图和当前代码发生冲突，按以下优先级判断：

1. `assets/site-design.css` 文件末尾最后生效的规则，以及 `assets/login.css` 的页面级规则。
2. 当前页面实际复用的 class、DOM 结构和 `scripts/site-ui.js` 行为。
3. 本文档记录的选择、组合和禁止事项。
4. `assets/styles.css` 中未被共享设计层覆盖的旧基础样式。
5. 历史截图、旧设计提示词或归档文档。

这不是允许实现者忽略本文档。若代码与本文档出现新冲突，必须同时修正代码或更新规范，不能让二者长期分叉。

---

## 1. 核心原则

### 1.1 双材质，而不是同一套阴影换颜色

浅色和暗色主题使用相同的信息架构、几何尺寸、圆角体系和组件语义，但遵循完全不同的材质物理：

| 主题 | 材质 | 深度来源 | 背景处理 | 禁止的做法 |
| --- | --- | --- | --- | --- |
| 浅色 | 新拟态 / Soft UI | 同色表面的左上亮影 + 右下暗影；按下时改为双内阴影 | 单色鼠尾草泥面，普通页面不使用背景模糊 | 玻璃透明面、`backdrop-filter`、普通卡片白底、单方向投影 |
| 暗色 | 玻璃拟态 | 半透明填充、1px 亮边、顶部高光、背景模糊、深色投影和后方 bloom | 深炭色场景 + 四处柔光 | 套用浅色双向实体阴影、纯黑不透明卡片、无边界透明层 |

### 1.2 组件语义优先于装饰

每个交互表面必须先确定物理语义，再选择预设组件：

- **平（flat）**：标题栏命令、未选中的分段项、纯信息行。
- **凸（raised）**：可按下并立即执行命令的普通按钮、主卡片、浮起面板。
- **凹（inset）**：输入区域、当前选中项、按住状态、展开状态、LCD 读数槽。
- **禁用（disabled）**：不是第四种深度；取消阴影、降低透明度并禁止 hover 恢复深度。

禁止仅凭“好看”给元素增加阴影。阴影必须表达该元素是可按下、已按下、可输入或独立浮层。

### 1.3 一个视觉层级只使用一个主表面

- 页面区段应当是无框布局或一个主面板，不能为了装饰把每一段都包成卡片。
- 禁止卡片中再放同等视觉重量的卡片。
- 卡片内部的信息行、标题行、统计行默认保持平面，用间距或细分隔线组织。
- 只有真正独立的重复项、对话框、问题表面、输入井或独立工具可以再次形成表面。

### 1.4 令牌是唯一颜色和材质来源

- 新页面必须使用现有 CSS 自定义属性，不得在页面级样式中重新抄写主题色、正文色、阴影或玻璃填充。
- 同一组件不得在浅色和暗色中分别写两套无关联的结构；应通过 `[data-theme="dark"]` 只替换材质变量或必要的可读性细节。
- 除本文“批准的上下文色”外，禁止新增品牌色、蓝色按钮、紫色渐变、纯白卡片或独立灰色体系。

---

## 2. 适用范围与文件责任

### 2.1 普通页面：标准接入方式

以下页面类型使用完整共享设计系统：主页、学生工具页、练习页、复习页、社区页、管理工具页。

必须按以下顺序加载资源：

```html
<script src="../scripts/theme-init.js"></script>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Share+Tech+Mono&display=swap" />
<link rel="stylesheet" href="../assets/styles.css" />
<link rel="stylesheet" href="../assets/site-design.css" />
```

`body` 必须包含 `site-ui`，学生页面同时包含 `student-ui`，并加一个页面专属 class：

```html
<body class="student-ui site-ui example-page">
```

资源责任必须保持清晰：

- `assets/styles.css`：旧基础布局、页面业务结构和仍未迁移的页面级规则。
- `assets/site-design.css`：共享主题令牌、材质、组件状态、跨页面覆盖和最终层叠决策。
- `scripts/theme-init.js`：首屏绘制前恢复主题，避免主题闪烁。
- `scripts/site-ui.js`：主题按钮、标题栏控件、移动菜单、跨标签页主题同步。
- 页面专属 CSS：仅处理该页面独有的布局，不得重新定义全站组件材质。

必须让 `site-design.css` 在 `styles.css` 后加载。不得颠倒顺序，也不得用页面内联样式绕过共享设计层。

### 2.2 认证页面边界

公开登录页使用以下专属组合：

```html
<body class="student-ui auth-page login-page">
```

并按顺序加载 `styles.css` 后的 `login.css`。`login.css` 是公开登录页的规范实现，保留同一套浅色新拟态 / 暗色玻璃拟态物理，但拥有双栏登录布局。

管理员登录页当前只使用 `styles.css`，是一个既有隔离页面。它不是新页面的组件模板，也不得把其中的旧硬编码颜色复制到其他页面。若未来重做管理员登录页，应迁移到公开登录页的双材质令牌和控件语义，而不是扩大旧样式的使用范围。

### 2.3 当前页面族

| 页面族 | 代表 body class | 标准表面 |
| --- | --- | --- |
| 主页 | `.home-dashboard` | 课程卡、资料对话框、移动快捷入口 |
| 章节练习 | `.chapter-practice-page` | 章节列表、模式分段、题目输入井 |
| 真题练习 | `.practice-page` | 试卷选择、模式卡、题目卡、题号导航、计时器 |
| 错题本 | `.notebook-page` | 视口内双栏、内部滚动记录、实体浮层 |
| 复习与分析 | `.review-page`、`.analysis-page` | 统计卡、答案表、图表和题目上下文 |
| 社区 | `.community-page` | 主内容面、筛选侧栏、帖子行、富文本编辑器、toast |
| 工具与管理 | `.utility-ui` | 数据表、工具面板、高不透明度详情对话框 |
| 公开认证 | `.auth-page.login-page` | 双栏登录壳、认证按钮、凹陷字段 |

---

## 3. 主题机制

### 3.1 主题状态

- 存储键必须为 `app-theme`。
- 有效值只能是 `light` 或 `dark`。
- 默认主题必须为 `dark`；不跟随系统主题。
- 暗色通过根元素 `<html data-theme="dark">` 表示。
- 浅色通过移除 `data-theme` 表示，不能写 `data-theme="light"` 后期待现有选择器生效。
- 必须同步 `document.documentElement.style.colorScheme`，让原生表单与滚动条采用正确配色。
- 主题初始化脚本必须在 CSS 之前运行，以防首屏闪烁错误主题。
- 用户点击主题按钮后必须写入 `localStorage`。
- 其他标签页修改 `app-theme` 时，当前页面必须通过 `storage` 事件同步。

### 3.2 主题按钮

- 必须复用 `#themeToggle`、`.site-header-control` / `.home-header-control` 和 `.home-theme-toggle`。
- 使用当前太阳/月亮线性图标结构；图标为 `22px`，`stroke-width: 2`。
- 按钮必须有动态 `aria-label` 与 `title`，文案说明“切换到”另一个主题。
- 图标只做旋转、缩放和透明度过渡；不得让切换造成按钮尺寸或标题栏布局变化。
- 标题栏中默认平，hover/focus 凸，按下凹。

---

## 4. 色彩系统

### 4.1 浅色色卡：Meadow Green Neumorphism

| 令牌 | 色值 | 强制用途 |
| --- | --- | --- |
| `--bg` | `#E6EAE3` | 页面背景、同材质主表面、浅色凹槽基底 |
| `--text` | `#37423B` | 标题、正文、主要数字、默认图标 |
| `--muted` | `#5F6C62` | 次要文字、说明、标签、未激活控件 |
| `--accent` | `#276846` | 主按钮、链接、焦点环、选中边框 |
| `--accent-light` | `#3B8A5E` | 主按钮 hover、强调交互反馈 |
| `--accent-teal` | `#3FA08C` | 成功状态、正确状态 |
| `--bloom-green` | `#A0CDA2` | 主题绿、开关开启、课程强调、柔光来源 |
| `--bloom-pink` | `#F6A6B3` | 粉色类别强调、暗色错误色来源 |
| `--bloom-mauve` | `#DEB7D5` | 淡紫粉类别强调 |
| `--bloom-cream` | `#FFFAC8` | 奶油色提示或类别强调 |
| `--bloom-sky` | `#A9D4E5` | 天蓝信息或类别强调 |
| `--ink-on-bloom` | `#1E3B29` | 浅色 bloom 填充上的深色文字 |
| `--error` | `#B0485E` | 错误、危险操作、退出登录 |
| `--lcd-glass` | `#CDD3C2` | LCD / 代码值凹槽背景 |
| `--lcd-ink` | `#46523F` | LCD / 代码值文字 |
| `--placeholder` | `#7A877C` | 输入占位符 |
| 浅色标题栏实体面 | `#EEF5F0` | 仅四种共享标题栏的内部浮动壳 |

结构表面必须以 `--bg` 为主。Bloom 五色用于科目区分、状态、小面积填充和暗色背景柔光，禁止用来铺满整个页面或让界面变成单一彩色主题。

### 4.2 暗色色卡：Meadow Glass

| 令牌 | 色值 | 强制用途 |
| --- | --- | --- |
| `--bg` | `#14171C` | 深炭色场景底色 |
| `--text` | `#E8ECEF` | 暗色标题和正文 |
| `--muted` | `#9AA4AD` | 暗色次要信息 |
| `--accent` | `#A0CDA2` | 链接、焦点、当前项、亮色读数 |
| `--accent-light` | `#C4E4C6` | 强调 hover |
| `--accent-teal` | `#4EC9B0` | 成功、正确 |
| `--ink-on-bloom` | `#0F1F15` | 亮绿 CTA 上的深色文字 |
| `--error` | `#F6A6B3` | 错误、危险动作 |
| `--glass-fill` | `rgba(255,255,255,0.07)` | 标准玻璃面 |
| `--glass-fill-hover` | `rgba(255,255,255,0.11)` | hover 玻璃面 |
| `--glass-fill-strong` | `rgba(255,255,255,0.13)` | 强玻璃面、需更清晰边界的浮层 |
| `--glass-fill-pressed` | `rgba(255,255,255,0.05)` | 按下或低亮度玻璃面 |
| `--glass-border` | `rgba(255,255,255,0.14)` | 标准 1px 玻璃边 |
| `--glass-border-soft` | `rgba(255,255,255,0.08)` | 内部分隔、输入井边界 |
| `--glass-highlight` | `rgba(255,255,255,0.22)` | 顶部高光 |
| `--glass-well` | `rgba(0,0,0,0.3)` | 凹陷输入、已选项、LCD 井 |
| `--glass-shadow-color` | `rgba(0,0,0,0.45)` | 标准深投影 |
| `--glass-shadow-hover` | `rgba(0,0,0,0.5)` | hover 深投影 |
| `--select-option-bg` | `#24292F` | 原生下拉选项实体底色 |

批准的上下文色：

- 暗色练习主操作允许使用 `#78AD7F`，文字必须为 `#0F1F15`。
- 收藏星标允许使用边框 `#D7B65D`、背景 `rgba(215,182,93,0.16)`、文字 `#F0CF78`。
- 这些颜色只限当前语义，不得升级为通用品牌色。

### 4.3 暗色背景柔光

暗色普通页面必须复用当前四处固定柔光：

```css
background:
  radial-gradient(640px 420px at 12% 8%, var(--glow-green), transparent 60%),
  radial-gradient(520px 520px at 88% 18%, var(--glow-mauve), transparent 60%),
  radial-gradient(720px 520px at 70% 95%, var(--glow-sky), transparent 60%),
  radial-gradient(480px 380px at 30% 80%, var(--glow-pink), transparent 60%),
  var(--bg);
background-attachment: fixed;
```

柔光必须位于玻璃后方。禁止把离散圆球、bokeh、装饰性渐变块放在内容前方；禁止让柔光降低文字可读性。

### 4.4 语义颜色规则

- 成功：`var(--status-good)` / `.good`。
- 错误：`var(--status-bad)` / `.bad`。
- 危险操作：`var(--error)`；只有真正执行破坏性或退出动作的按钮才使用。
- 退出登录红色只应用于带正确退出 `data-i18n` 的 `#logoutHome` / `#communityLogout`，访客状态的“登录”命令不能继承红色。
- 颜色不能是状态的唯一提示；同时使用文字、图标、边框或 `aria-*` 状态。
- 原始试卷图像必须保留白色或可读实体底色，暗色主题不得给扫描图套透明深色滤镜。

---

## 5. 材质、阴影与深度

### 5.1 浅色新拟态光源

光源固定来自左上方。所有凸起表面使用左上负偏移亮影和右下正偏移暗影；所有凹陷表面把同一对阴影改为 `inset`。不得改变单个组件的光源方向。

| 令牌 | 精确值 | 用途 |
| --- | --- | --- |
| `--surface-shadow` | `9px 9px 16px rgba(146,163,143,.55), -9px -9px 16px rgba(255,255,255,.6)` | 标准主表面 |
| `--surface-shadow-hover` | `13px 13px 22px rgba(146,163,143,.7), -13px -13px 22px rgba(255,255,255,.6)` | 大表面 hover |
| `--surface-shadow-small` | `5px 5px 10px rgba(146,163,143,.55), -5px -5px 10px rgba(255,255,255,.6)` | 普通按钮、紧凑浮层 |
| `--surface-shadow-pressed` | `inset 6px 6px 10px rgba(146,163,143,.55), inset -6px -6px 10px rgba(255,255,255,.6)` | 标准按下 |
| `--surface-shadow-deep` | `inset 10px 10px 20px rgba(146,163,143,.7), inset -10px -10px 20px rgba(255,255,255,.6)` | 输入井、深凹槽 |
| `--surface-shadow-inset-small` | `inset 3px 3px 6px rgba(146,163,143,.55), inset -3px -3px 6px rgba(255,255,255,.6)` | 分段选中、标题栏按下 |
| `--dialog-shadow` | `18px 18px 36px rgba(146,163,143,.7), -18px -18px 36px rgba(255,255,255,.6)` | 标准对话框 |

浅色表面：

- 必须使用实体同色背景。
- 普通表面边框默认透明，深度由阴影表达。
- 不得使用 `backdrop-filter`。
- 不得用纯白卡片与鼠尾草背景形成传统 SaaS 卡片对比。

### 5.2 暗色玻璃物理

标准暗色玻璃必须同时具备：

- 半透明 `--surface-raised` 填充；
- `1px solid var(--surface-border)`；
- `inset 0 1px 0 var(--surface-highlight)` 顶部亮边；
- `0 18px 40px var(--glass-shadow-color)` 深投影；
- `backdrop-filter: blur(20px) saturate(160%)` 及 `-webkit-backdrop-filter`；
- 后方可见但克制的 Meadow bloom。

暗色凹陷状态必须改用 `--glass-well` 和内阴影，不得使用暗色实体双向新拟态阴影。

### 5.3 必须遮挡下层内容的实体表面例外

玻璃透明度不能凌驾于可读性。以下表面浮在大量文字或列表内容正上方时，必须使用高不透明度或实体底色：

- 错题本组卷对话框；
- 粘在内部滚动列表底部的分页条；
- 管理员详情对话框；
- 展开的移动导航菜单；
- 任何滚动内容会从其下方穿过、导致文字叠字的悬浮工具条。

在这些场景，普通暗色玻璃 `--card-bg` 可能仍然透出下层内容，必须改用 `var(--bg)` 或批准的约 `0.94` 高不透明度表面。实体化是可读性规则，不代表暗色主题改成新拟态。

### 5.4 平 / 凸 / 凹预设 class

必须直接复用：

```html
<button class="control-flat" type="button">标题栏命令</button>
<button class="control-raised" type="button">普通操作</button>
<button class="control-inset" type="button" aria-pressed="true">当前选中</button>
```

不得为单个按钮重新写 `box-shadow` 来模拟上述状态。

---

## 6. 圆角系统

圆角必须从以下层级选择，不得随意新增 `10px`、`14px`、`22px`、`30px` 等相邻值：

| 尺度 | 用途 | 当前实例 |
| --- | --- | --- |
| `32px` | 旗舰容器、课程卡、公开登录壳 | `.course-card`、`.login-shell` |
| `28px` | 桌面浮动标题栏内壳 | 四种 `*topbar__inner` |
| `24px` | 标准主面板、移动标题栏内壳、书本封面 | `.card`、`.panel`、`.subject-book__cover` |
| `20px` | 对话气泡、独立反馈面 | `.site-pet__bubble` |
| `18px` | 题目表面、模式卡、统计卡、移动快捷条 | `.question`、`.mode-option-card` |
| `16px` | 所有标准按钮、输入框、选择框、标题栏控件 | `.btn-primary`、`input`、`.site-header-control` |
| `13px` | 移动快捷条内部链接 | `.home-mobile-shortcuts a` |
| `12px` | 紧凑按钮、题号、LCD 小标签 | `.jump-btn`、`.subject-book__code` |
| `8px` | 高密度管理员详情对话框等历史工具表面 | `.admin-detail-dialog`，仅既有例外 |
| `999px` | 真正胶囊或开关轨道 | toggle、状态 pill；不得用于普通按钮和卡片 |
| `50%` | 圆形 LED、状态点 | 仅正方形元素 |

同一组件在桌面和移动端可以从 `32px` 降为 `24px`，但不得改变其层级语义。

---

## 7. 排版

### 7.1 字体族

- 正文、按钮、表单：`DM Sans`，回退到 `-apple-system`、`BlinkMacSystemFont`、`Segoe UI`、`PingFang SC`、`Microsoft YaHei`、`sans-serif`。
- 标题、品牌、卡片主标题：`Plus Jakarta Sans`，回退到 `DM Sans`。
- 计时器、LCD、试卷代码、固定宽度读数：`Share Tech Mono`，回退到 `ui-monospace`、`monospace`。
- 不得在单页引入新的展示字体。
- 中文字符自然使用系统中文回退，不单独指定风格冲突的中文字体。

### 7.2 字重

- 正文：`400` 或 `500`。
- 次级标签：`500`。
- 按钮、导航、强调标签：`700`。
- 品牌和最高层级标题：`700` 或 `800`。
- 禁止用超细字重表现“高级感”；暗色玻璃上必须保证笔画清晰。

### 7.3 当前字号层级

| 场景 | 桌面参考 | 移动参考 | 规则 |
| --- | --- | --- | --- |
| 首页主标题 | `3rem / 1.08 / 800` | 按现有媒体规则收紧 | 只用于真正页面主标题 |
| 公开登录品牌 | `3.15rem / 1.05` | `2.35rem` | 品牌是首屏主要信号 |
| 公开登录标题 | `3rem / 1.1 / 700` | `2.15rem`，窄屏 `1.95rem` | 不得挤压表单宽度 |
| 普通页面标题 | 约 `1.55rem` 至 `3rem` | 根据容器层级收紧 | 工具面板内不得使用 hero 字号 |
| 面板标题 | `1.05rem` 至 `1.25rem` | 保持紧凑 | 与主标题必须形成清晰层级 |
| 正文 | `1rem`，默认 `16px` | 不随视口宽度缩放 | 行高通常 `1.4` 至 `1.65` |
| 按钮 | `0.78rem` 至 `0.94rem`，`700` | 可收至 `0.78rem` | 文字必须完整可读 |
| 标签/说明 | `0.82rem` 至 `0.9rem` | 同级保持一致 | 使用 `--muted` |
| eyebrow | `0.72rem / 700 / uppercase` | 保持克制 | 只作为页面上下文标签 |
| LCD/计时器 | `0.95rem / 700` | `0.76rem` | 使用 tabular numerals |

### 7.4 文字规则

- 全站 `letter-spacing` 必须为 `0`；不得使用负字距，也不得以宽字距作为装饰。
- 标题、按钮和长双语字符串必须允许换行。
- 所有 grid / flex 子项应设置 `min-width: 0`。
- 用户名、试卷编号、长标题和链接必须使用 `overflow-wrap: anywhere`。
- 只允许在明确单行的标题栏副标题使用省略号；不得让关键命令文字被无提示截断。
- 数字计时器必须使用 `font-variant-numeric: tabular-nums`，避免宽度跳动。

---

## 8. 间距、尺寸和布局

### 8.1 间距基准

布局应优先从当前常用尺度选择：`4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 72px`。

- 同组标题栏控件：`4px` 至 `6px`；移动可为 `2px`。
- 紧凑操作组：`8px` 至 `12px`。
- 标准表单/按钮组：`14px` 至 `18px`。
- 面板内部区块：`18px` 至 `24px`。
- 页面主区块：`32px` 至 `48px`。
- 首屏顶部留白：普通内容约 `40px`；主页主内容约 `72px`。

不要为“更灵活”建立新的全局间距系统。新布局应先复用当前尺度。

### 8.2 容器宽度

- 普通 `.container`：`min(1120px, 100% - 48px)`。
- 标准标题栏内壳（包括主页）：`min(1180px, 100% - 32px)`。
- 主页主内容：`min(1280px, 100% - 48px)`。
- 真题练习工作区：`min(1180px, 100% - 32px)`。
- 社区与具体工具可在此范围内根据信息密度收紧，但不得产生普通页面水平滚动。

### 8.3 触控和稳定尺寸

- 所有主要交互目标必须至少 `44px × 44px`。
- 标准正文按钮最小高度为 `44px`；主页主要按钮通常 `48px`。
- 输入框、选择框最小高度 `48px`。
- 图标标题栏按钮固定 `44px × 44px`；公开登录移动端主题按钮当前为 `40px × 40px`，这是经过验证的页面级例外。
- 方形题号按钮必须用稳定宽高或 `aspect-ratio: 1`，状态变化不得改变布局。
- 加载、hover、标签变化和动态文本不得改变卡片网格轨道、工具条高度或按钮尺寸。

### 8.4 页面滚动

- 普通页面不得出现水平滚动。
- `.table-wrap` 是唯一批准的常规横向滚动表面；使用 `overflow-x: auto`。
- 禁止通过全局 `overflow: hidden` 掩盖布局错误。
- 错题本类工作台可以让页面本身固定在视口内、列表区域内部滚动，但必须建立完整 `min-height: 0` 的 flex/grid 高度链。
- 粘性侧栏在移动端必须回到文档流，不能覆盖题目。

---

## 9. 按钮与命令组件

任何按钮必须从本节预设中选择。禁止创建 `.green-button-2`、页面 ID 专属阴影或手写一套相近按钮。

### 9.1 主按钮

用途：页面主要提交、开始、保存、生成、下载题目。

```html
<button class="btn-primary" type="button">开始练习</button>
```

规则：

- 浅色：`--accent` 实体填充、白字、强调色专用双影。
- 暗色：亮绿填充或现行半透明亮绿、深色 `--primary-text`、绿光和玻璃边。
- hover 使用 `--accent-light` 并最多上移 `1px`。
- active 必须转为凹陷状态，不得继续保持外阴影。
- 一个操作区通常只有一个视觉主按钮。

### 9.2 次按钮

用途：返回、取消、次级工具、重试。

```html
<button class="btn-secondary" type="button">取消</button>
```

- 默认凸起；浅色与背景同材质，暗色为标准玻璃。
- hover 增强外阴影；active 转为凹陷。
- 不得通过灰色实心矩形模拟次按钮。

### 9.3 链接式按钮

```html
<a class="btn-link" href="...">查看详情</a>
```

仅当命令语义需要按钮外观、但元素本身是导航链接时使用。真正页面导航优先 `<a>`，业务动作优先 `<button type="button">`。

### 9.4 标题栏按钮

标题栏命令必须使用现有 `.site-header-control`、`.home-header-control`、`.home-nav-button` 或 `.site-header-command`，默认物理状态如下：

| 状态 | 表面 | 文字/边框 | 位移 |
| --- | --- | --- | --- |
| 默认 | flat，无阴影，透明背景 | `--muted` 或正文色 | 无 |
| hover | raised，`--surface-shadow-small` | 暗色加玻璃边 | 无最终位移 |
| focus-visible | raised + 双焦点环 | 保留清晰焦点 | 最多 `-1px` |
| active | inset small | 普通正文色 | 无 |
| `.is-open` / `aria-expanded="true"` | 持续 inset small | 普通正文色 | 无 |

最终按下/展开规则位于 `site-design.css` 文件末尾，必须让其在 focus 后生效，保证按下状态优先。

返回首页命令应由 `site-ui.js` 移入标题栏，并转成 `.btn-secondary.site-header-command`；不要在正文顶部再造一个不同风格的返回按钮。

### 9.5 图标按钮

- 熟悉命令优先只显示图标；当前主题、菜单和关闭控件必须沿用现有图标结构。
- 图标按钮必须有 `aria-label`；不熟悉的图标同时提供 `title`。
- 图标不得改变按钮盒子尺寸。
- 未引入全站图标库前，不得在单页引入另一套图标风格；优先复用当前线性 SVG 和既有图标。
- 关闭按钮使用现行 `.profile-dialog__close` 或对应对话框关闭 class，不得显示文字胶囊“关闭”替代熟悉符号，除非操作需要更强确认。

### 9.6 危险按钮

- 只用于删除、重置、退出或不可逆操作。
- 使用 `var(--error)` 文字/边框语义；不要把粉色当普通强调色。
- 危险按钮必须有明确动词，必要时进入确认对话框。
- 访客登录、返回、取消不得染成危险色。

### 9.7 禁用和加载

- 原生按钮必须使用 `disabled`；链接式控件用 `aria-disabled="true"` + `.is-disabled`。
- 禁用透明度：标准站点 `0.45`；公开登录加载/禁用态当前为 `0.62`。
- 禁用时取消阴影和 transform，不允许 hover 恢复阴影。
- 加载状态必须保留原按钮尺寸和原文区域，避免工具条跳动。

---

## 10. 表单组件

### 10.1 标签与字段结构

必须让每个字段拥有可访问标签：

```html
<label>
  <span>目标分</span>
  <input type="number" min="0" max="100" placeholder="例如 90" />
</label>
```

- 标签：`0.88rem`、`500`、`var(--muted)`。
- 字段：宽度 `100%`、最小宽度 `0`、最小高度 `48px`、圆角 `16px`。
- 默认字段必须为深凹面：浅色 `--bg + --surface-shadow-deep`；暗色 `--glass-well + soft border + inset shadow`。
- placeholder 使用 `--placeholder`，不能与真实值一样醒目。

### 10.2 焦点

普通输入在 focus-visible 时必须保留凹陷，再增加：

```css
outline: 2px solid var(--focus-inner);
outline-offset: 2px;
box-shadow: var(--surface-shadow-deep), 0 0 0 4px var(--accent);
```

焦点不是新的物理深度。禁止用取消凹陷、突然变凸或仅改背景色表示焦点。

### 10.3 类型例外

自动凹陷规则必须排除：

- `input[type="radio"]`
- `input[type="checkbox"]`
- `input[type="range"]`
- `input[type="file"]`

这些控件必须使用各自模板，不能继承文本框的 100% 宽和深凹阴影。

### 10.4 校验状态

- 错误字段使用 `aria-invalid="true"`。
- 错误提示使用 `role="alert"`，并与字段建立可访问关联。
- 错误色为 `var(--error)`，同时增加错误边界/焦点环；不能只显示红色占位符。
- 成功提示使用 `.good` 或页面现有成功状态，且应在 `role="status"` / `aria-live` 区域播报。
- 不显示的状态元素必须使用 `[hidden]`，共享规则确保其不占空间。

### 10.5 选择框

- 外观与文本输入一致，默认凹陷。
- 暗色原生 option 必须使用 `--select-option-bg: #24292F` 和 `--text`。
- 选择框不得用浏览器默认白色弹层之外的页面白底模拟。

### 10.6 Checkbox 与筛选

- 复选框本体固定约 `22px × 22px`，不能继承标准输入高度。
- label 行的有效触控高度至少 `44px`。
- 复选框与文字使用两列：`22px minmax(0,1fr)`，间距约 `10px`。

### 10.7 开关

必须复用 `.setting-toggle`：

```html
<label class="setting-toggle">
  <input type="checkbox" checked />
  <span aria-hidden="true"></span>
  <strong>显示宠物</strong>
</label>
```

- 轨道 `44 × 26px`，胶囊圆角。
- 拇指 `20 × 20px`，距边 `3px`。
- off：凹陷轨道；on：`--bloom-green`，拇指平移 `18px`。
- 暗色 on 可增加 `0 0 12px var(--glow-green)`。
- 键盘焦点必须显示内外焦点环。

### 10.8 富文本输入

- 使用现有 `.rich-text-editor`，仍遵循深凹输入语义。
- 数学键盘、格式菜单和关闭控件是独立次级界面，不得嵌成多个同重卡片。
- 无效状态使用 `.is-invalid`，不能通过内联红色样式实现。
- 用户生成内容的 Markdown、公式、图片和长链接必须在容器内换行且不能造成页面横向滚动。

---

## 11. 选择、分段和导航状态

### 11.1 模式卡

真题模式选择必须复用 `.mode-option-card`：

```html
<label class="mode-option-card selected">
  <input type="radio" name="practiceMode" value="practice" checked />
  <span class="mode-option-radio"></span>
  <span class="mode-option-copy">
    <strong>Practice Mode</strong>
    <small>Take your time without constraints</small>
  </span>
</label>
```

状态必须为：

- 未选中：flat。
- 未选中 hover：raised small。
- `.selected`：accent 边界 + inset；暗色用 `--glass-well`。
- 隐藏 radio focus：整张卡用 `:focus-within` 显示焦点轮廓。

禁止让未选中卡默认全部凸起，这会降低当前项辨识度。

### 11.2 章节 / 真题分段控件

必须复用 `.chapter-mode-switch` 和 `.is-active`：

- 外壳仅分组，保持 flat。
- 未选按钮 flat，hover raised。
- 当前 `.is-active` 使用 accent 边界、`--surface-pressed` 和 `--surface-shadow-inset-small`。
- 当前项不得同时带外围 raised 高光。
- 必须同步 `role="tab"`、`aria-selected` 与视觉状态。

### 11.3 题号导航

- `.jump-btn` 默认 flat、正方形、圆角 `12px`。
- hover raised small。
- `.active` 使用 accent 边界 + inset small。
- 已作答、当前、正确、错误等状态需要文字或符号辅助，不能只依赖颜色。

### 11.4 信息行不是按钮

`.paper-set-item` 只展示试卷信息，整行必须 flat、无圆角、无阴影，以顶部分隔线组织。真正动作只放在行内按钮。禁止让不可点击的信息行看起来像凸起按钮。

---

## 12. 卡片、面板与信息表面

### 12.1 标准主表面

优先复用：`.card`、`.panel`、`.paper-picker`、`.mode-landing`、`.chapter-practice-workspace`、`.chapter-band`、`.community-surface`、`.community-filter-card`。

- 最小宽度 `0`。
- 标准圆角 `24px`。
- 浅色使用 `--surface-raised + --surface-shadow`，不模糊。
- 暗色使用标准玻璃边、填充、阴影和 `--surface-blur`。
- 标准内边距通常 `24px`。

### 12.2 次级凹陷表面

题目上下文、统计、答案区域、模式选择、图表或预览可使用当前次级集合：

- 圆角 `18px`。
- 浅色 `--bg + --surface-shadow-deep`。
- 暗色 `--glass-well + soft border + inset shadow`。

只有承载输入、当前选择或嵌入读数时才使用凹面。普通信息段落不得全部放入凹槽。

### 12.3 首页课程卡

`.course-card` 是首页专用旗舰组件：

- 四列桌面网格，`32px` 间距；1023px 以下两列；767px 以下单列。
- 最小高度 `438px`，圆角 `32px`，内边距 `28px 24px 24px`。
- 默认 raised；hover 增强并最多上移 `3px`；active inset。
- 科目仅通过 `--subject-bloom`、`--subject-soft`、`--subject-glow` 更换小面积强调。
- 暗色 bloom 必须位于卡片内部后方并模糊，不能遮挡文字。
- 书本封面、书脊、徽标和 LCD 代码必须保持现有结构；不得用通用图标卡替代实际学科对象。

### 12.4 章节卡

- 章节卡外层可形成主表面。
- `.chapter-band__heading` 与 `.chapter-section-row` 内部必须透明、平整，以细分隔线组织。
- `.chapter-number` 是信息标签：accent 填充，无立体阴影。
- 统计项内部不得再做卡片。

### 12.5 统计与读数

- 统计面板必须可扫描，标签用 `--muted`，值用 `--text`。
- LCD / 代码使用 `--lcd-glass`、`--lcd-ink`、凹陷小阴影和 `Share Tech Mono`。
- 暗色 LCD 用 smoked well、accent 数字和克制绿光。
- 数据位数变化不得引起布局跳动。

---

## 13. 标题栏与导航

### 13.1 四种共享标题栏

标准类只有：

- `.home-topbar` + `.home-topbar__inner`
- `.site-topbar` + `.site-topbar__inner`
- `.chapter-topbar` + `.chapter-topbar__inner`
- `.community-topbar` + `.community-topbar__inner`

外层负责 sticky、z-index 和安全区；内壳负责实际材质、圆角、宽度和三列布局。

### 13.2 几何

- 桌面：外层最小高度约 `82px + safe-area`，内壳宽度 `min(1180px, 100% - 32px)`，最小高度 `64px`，圆角 `28px`。
- 首页内容宽度可扩到 `1280px`，但控件位置必须与其他标题栏保持品牌左、弹性中栏、命令右。
- 移动：外层最小高度约 `72px + safe-area`，内壳宽 `100% - 16px`，最小高度 `58px`，圆角 `24px`，内边距 `6px 8px`。
- 品牌、标题和操作必须使用 `auto minmax(0,1fr) auto` 三列，避免右侧命令挤出屏幕。

### 13.3 材质

- 浅色标题栏内壳必须为不透明 `#EEF5F0`，关闭 backdrop blur；保留既有圆角、边框、高光和投影。
- 暗色标题栏内壳必须保持透明玻璃，支持 blur 时使用 `rgba(24,30,33,0.5)` 与 `blur(26px) saturate(180%) contrast(108%)` 的现行浮动标题栏处理。
- 内壳高光伪元素不得挡住交互，所有真实子元素 `z-index: 1`。
- 禁止把整条视口宽度重新加回暗色玻璃背板；当前设计是浮动圆角内壳。

### 13.4 品牌

- 使用 `.home-brand`，文字为 ExPassway。
- 标志 `.home-brand__mark` 固定 `42 × 42px`，圆角 `16px`，字母 `E`。
- 暗色标志可使用绿光，浅色使用 accent 专用双影。
- 移动仍应显示 ExPassway；只有极窄屏且命令无法容纳时才允许按现有 430px 规则处理，不能默认只留字母 E。

### 13.5 移动菜单

- 768px 以下使用 `#homeMenuToggle`、`aria-controls`、`aria-expanded` 和 `.is-open`。
- 展开面必须足够不透明，内容滚动时文字不能穿透叠加。
- 点击菜单内命令或按 Escape 后关闭；关闭时按需要恢复焦点。
- 切换到桌面断点必须自动关闭移动菜单。

---

## 14. 对话框、浮层与反馈

### 14.1 标准对话框

使用原生 `<dialog>` 和 `.profile-dialog`：

```html
<dialog class="profile-dialog" aria-labelledby="dialogTitle">
  <div class="profile-dialog__shell">
    <div class="profile-dialog__header">
      <h2 id="dialogTitle">标题</h2>
      <button class="profile-dialog__close" type="button" aria-label="关闭">×</button>
    </div>
    <!-- content -->
  </div>
</dialog>
```

- 宽度必须用 `min()` 限制并留至少 `16px` 至 `32px` 视口边距。
- 最大高度不能超过视口；长内容在对话框 body 内滚动。
- backdrop 必须降低下层干扰；暗色可配合模糊。
- 关闭按钮必须在标题行内，至少 `44 × 44px`。
- 打开后焦点进入对话框，关闭后恢复到触发控件；Escape 行为不得被破坏。

### 14.2 管理员详情对话框

`.admin-detail-dialog` 是高密度、必须遮挡下层数据的批准例外：

- 最大宽度 `1100px`，视口边距至少 `16px`。
- 约 `0.94` 高不透明度表面，而非标准 7% 玻璃。
- 标题栏固定，body `overflow: auto`、`overscroll-behavior: contain`。
- 当前 `8px` 圆角是工具页历史例外，不用于新普通卡片。

### 14.3 Toast 与状态区

- 使用已有 `.community-toast-region` / `.community-toast`。
- toast 必须位于标题栏下方并考虑 `safe-area-inset-top`。
- 成功使用 `.is-success`；错误使用错误语义，不通过随机背景色区分。
- 状态消息应使用 `role="status"` 或 `aria-live="polite"`；错误可用 `role="alert"`。
- toast 不得遮挡标题栏、移动菜单或关键提交按钮。

### 14.4 宠物气泡

- 宠物本体与气泡是独立 elevated surface，不得塞进页面卡片。
- 气泡圆角 `20px`，暗色使用强玻璃，浅色使用 raised 实体面。
- 消息区最小高度 `44px`；关闭按钮 `44 × 44px`。
- 左右停靠时气泡必须留在视口内，移动端在标题栏下方展开。

---

## 15. 真题与章节练习专用规范

### 15.1 真题打开前

- 试卷选择主面使用 `.paper-picker`。
- 筛选栏自身 flat；内部 `select` 仍为 inset。
- 试卷信息行 flat；开始/重试按钮使用既有主/次模板。
- 模式页使用模式卡规则，不能用两个普通 CTA 表示互斥选择。

### 15.2 真题打开后

- 外层 `#generateHero` 与 `#resultPanel` 退为无框页面区段，避免再包一层大卡。
- 单题 `.question` 才是 raised 主表面，圆角 `18px`、内边距 `24px`。
- 作答 `.option-item` 是 inset 输入区域，最小高度 `52px`、圆角 `16px`。
- 选中项使用 accent 边界 + pressed 填充；正确/错误反馈必须保留语义边界。
- 右侧 `.question-side` 为 sticky raised 工具面；移动端回到普通流。
- `.text-view-box`、`.tag` 为轻量信息表面，保持 flat，不增加外阴影。

### 15.3 计时器

- 只在限时模式且试卷已打开时显示；其他情况使用 `[hidden]` 完全移除。
- 位于 sticky 标题栏操作区。
- 桌面最小宽 `150px`，移动最小宽 `116px`。
- 使用凹陷小阴影、`Share Tech Mono`、tabular numerals。
- 状态点可以使用 error 色，但不得闪烁或造成注意力干扰。
- 计时器 hover 不改变物理状态。

### 15.4 章节练习

- 模式切换使用 `.chapter-mode-switch`。
- 章节信息行内部保持 flat。
- 每道题的 `.option-item` 必须是明确 inset 输入井。
- 上一题/下一题使用次按钮，提交使用主按钮。

---

## 16. 社区和数据密集页面

### 16.1 社区布局

- 桌面使用主内容 + 右侧 rail；主内容必须 `min-width: 0`。
- rail 可以 sticky，但 900px 以下必须变为单列。
- 筛选使用 `<details>` / `<summary>` 时，移动端必须有清晰展开指示和 open 状态。
- 帖子列表行应保持轻量；hover 仅提供必要反馈，不得每行变成厚重嵌套卡。
- 富文本、公式、问题引用和图片必须在主列内收缩。

### 16.2 数据表

- 表格外使用 `.table-wrap`，这是唯一批准的普通横向滚动容器。
- 表头、单元格和操作按钮必须保持高信息密度，不使用 hero 字号或过大圆角。
- 对话框中的表格滚动必须限定在 body，不得撑高整个视口。
- 表格行操作使用紧凑按钮或图标按钮，不能堆叠多个大 CTA。

### 16.3 错题本工作台

- 页面、shell、两栏布局、记录卡和列表之间必须形成可收缩的 flex/grid 高度链；每一级按需要设置 `min-height: 0`。
- 记录列表内部滚动，页面标题和筛选工具保持可见。
- 分页条粘在滚动区底部时必须使用实体 `var(--bg)` 遮住下方记录，并有细顶边界。
- 组卷浮层必须居中 fixed、实体表面、最大高度受限、内部可滚动且操作可换行。
- 禁止用写死标题栏高度的 `calc(100vh - 68px)` 推导整页高度；标题栏实际高度会随安全区和响应式变化。

---

## 17. 公开登录页规范

公开登录页是认证场景的唯一推荐模板。

### 17.1 布局

- 页面最小高度 `100svh`，允许纵向滚动，禁止横向滚动。
- 桌面壳宽 `min(100%, 1000px)`、最小高 `600px`、圆角 `32px`。
- 两列为品牌 `40%` + 表单 `60%`，并使用 `minmax()` 防止内容撑破。
- 品牌区与表单区是同一个壳的两个区域，不得做成两张并列卡片。
- 760px 以下变为单列：品牌区在上、表单区在下，壳圆角降为 `24px`。

### 17.2 材质

- 浅色必须是纯 `#E6EAE3` 新拟态，不显示旧版彩色 glow 背景，不使用 blur。
- 浅色登录壳使用 `14px` 级双向外影；字段 inset，第三方登录按钮 raised。
- 暗色使用与主页相同的四处 bloom 背景。
- 暗色壳为 `7%` 玻璃、标准玻璃边、`20px / 160%` blur。
- 暗色字段为 smoked well；主提交为约 92% bloom green，深色文字。

### 17.3 控件

- 第三方登录：`.auth-provider-button`，raised。
- Email/OTP 输入：`.auth-input`，inset。
- 提交：`.auth-submit-button`，primary raised。
- 访客入口：`.login-visitor-button`，与提交按钮同级材质，但位于品牌区。
- 重发 OTP：`.auth-otp-resend`，紧凑内联控件，不得盖住验证码文字。
- 返回其他邮箱：`.auth-back-link`，文本命令。
- 标题栏主题/语言控件必须与主页一致：flat -> raised -> inset；桌面 44px，移动主题控件 40px。

### 17.4 状态和动效

- OTP 步骤可使用 `260ms ease` 的轻微水平进入动画。
- `prefers-reduced-motion: reduce` 时取消该动画和控件过渡。
- 错误字段使用 `aria-invalid` + error ring；错误文字必须保留。
- 禁用登录按钮可用 `cursor: wait`，保持原尺寸。

---

## 18. 图片、图标、图表与公式

- 产品和学习页面的主图必须显示真实题目、教材或实际内容；不能用模糊氛围图代替需要阅读的资料。
- 试题图片、复习图片、社区问题引用图片和 Markdown 图片必须 `max-width: 100%`。
- 考试扫描图必须有可读实体背景；暗色模式不得改变原题颜色。
- 当前安全边界只允许同源、`data:` 和 `blob:` 图片；设计不得依赖任意跨域图片。
- KaTeX / MathLive 内容必须保持公式可读、可滚动或可换行，不得被玻璃透明度削弱。
- 图表使用语义色并提供文本/表格替代信息；不能只通过 bloom 色区分系列。
- 禁止新增装饰性 SVG hero、渐变插画或与学习任务无关的背景图形。

---

## 19. 动效

### 19.1 标准时长

- 全站主题和表面变化：`300ms ease-out`（`--transition-ui`）。
- 主题太阳/月亮：transform `400ms cubic-bezier(0.45,0,0.25,1)`，opacity `300ms ease-out`。
- 登录步骤：`260ms ease`。

### 19.2 允许的变化

- 普通按钮 hover 最多上移 `1px`。
- 首页课程卡 hover 最多上移 `3px`。
- active 最多下移 `0.5px` 至 `1px`，但最终标题栏按下态不位移。
- 主题图标可旋转、缩放、淡入淡出。
- 禁止弹跳、持续漂浮、无限闪烁、夸张缩放和造成布局变化的动画。

### 19.3 减弱动效

必须提供 `@media (prefers-reduced-motion: reduce)`：

- animation 设为 `none`；
- transition 设为 `none` 或现行兼容实现要求的 `0s`；
- 不得用 `0.01ms` 伪装取消动效。

---

## 20. 响应式规范

### 20.1 主断点

| 断点 | 用途 |
| --- | --- |
| `1023px` | 首页课程网格由四列降为两列 |
| `900px` | 社区双栏转单栏、筛选折叠 |
| `767px` | 全站主要移动布局、标题栏、菜单、单列卡片、练习侧栏回流 |
| `760px` | 公开登录双栏转单栏 |
| `640px` / `620px` | 宠物气泡、社区紧凑布局 |
| `430px` / `420px` | 极窄标题栏和公开登录内边距/字号修正 |

新页面应优先使用 `767px` 主断点，只有组件确实在其他宽度发生内容断裂时才增加已存在的次断点。

### 20.2 移动要求

- 必须考虑 `env(safe-area-inset-top/right/bottom/left)`。
- 内容左右最少保留 `8px` 至 `16px`，普通主内容通常 `20px` 至 `24px` 总收缩。
- 多列网格转单列；表单两列转单列；操作组允许换行。
- 标题栏品牌、当前页信息和主要命令不得互相覆盖。
- 长中文和英文必须在容器内换行；最长单词仍不得撑破。
- 固定 toast、宠物气泡和对话框必须避开浮动标题栏。
- 不通过随视口连续缩放字号解决溢出；使用断点、换行和稳定容器。

---

## 21. 可访问性

所有新页面必须满足以下条件：

- 正文和关键控件达到 WCAG AA 对比度；不能因为玻璃后方 bloom 改变而失去可读性。
- 所有键盘可操作元素有清晰 `:focus-visible`，使用 `focus-inner + accent` 双环。
- focus 不能仅靠阴影深度变化表示。
- 所有图标按钮有可访问名称。
- 互斥选择使用 radio / tab 语义，并同步 `aria-selected` / `checked`。
- 展开按钮使用 `aria-expanded` 和 `aria-controls`。
- 对话框使用 `aria-labelledby`，打开/关闭焦点正确。
- 状态反馈使用 `role="status"` / `aria-live`；立即错误使用 `role="alert"`。
- 隐藏元素使用 `[hidden]`，不能只设透明度后仍可聚焦。
- 最小触控目标通常 `44 × 44px`。
- 颜色不是唯一状态信号。
- 支持 `prefers-reduced-motion`。
- 页面放大到 200% 时仍能完成主要工作流，不出现内容覆盖。

---

## 22. 双语与内容边界

- 所有系统 UI 文案必须接入现有 `data-i18n`、`data-i18n-placeholder`、`data-i18n-aria-label` 或 JavaScript 翻译函数。
- 控件在英文和中文下必须保持完整、可换行且不覆盖相邻内容。
- 不得缩小到不可读字号来容纳英文长词。
- 用户发布的帖子、标题、回复、标签、题目和自由输入内容不得当作系统模板翻译。
- 页面语言切换后，主题按钮和移动菜单的 `aria-label` / `title` 必须同步更新。
- i18n 初始化前可以隐藏 body，初始化完成后必须恢复，避免显示错误语言闪烁。

---

## 23. 明确禁止事项

以下做法一律视为与当前设计不一致：

1. 在浅色普通页面使用半透明玻璃卡、背景模糊或彩色 glow。
2. 在暗色页面把浅色双向新拟态阴影直接换成黑色后继续使用。
3. 写死新颜色、阴影和圆角而不先检查现有令牌和组件 class。
4. 普通按钮使用蓝色、紫色渐变、纯白卡片或传统 Bootstrap 风格。
5. 标题栏按钮默认凸起；正确状态是默认平、hover/focus 凸、按下/展开凹。
6. 输入框默认凸起；文本输入必须为凹面。
7. 已选模式同时保留外阴影和内阴影；当前项只用 inset + accent。
8. 把不可点击的信息行做成按钮卡片。
9. 卡片里再嵌套同等重量卡片，或把每个页面区段都做成浮动卡。
10. 为普通矩形按钮使用 `999px` 胶囊圆角。
11. 通过负字距、视口连续字号缩放或超大面板标题营造视觉效果。
12. 让文字、按钮、toast、宠物气泡、标题栏或对话框互相覆盖。
13. 用全局 `overflow: hidden` 掩盖布局溢出。
14. 让透明粘性工具条下面的列表文字穿透叠字。
15. 隐藏键盘焦点或只靠颜色表示选中、正确、错误。
16. 创建只有 hover 没有键盘/触摸等价反馈的操作。
17. 改变既有 DOM ID、i18n key 或业务事件来完成纯视觉修改。
18. 在新页面复制管理员登录页的旧硬编码认证颜色。
19. 引入新的单页图标库、展示字体或装饰风格。
20. 未做浅色/暗色、桌面/移动和长文本验证就宣称设计完成。

---

## 24. 新页面最小模板

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title data-i18n="examplePageTitle">Example</title>
  <script src="../scripts/theme-init.js"></script>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Share+Tech+Mono&display=swap" />
  <link rel="stylesheet" href="../assets/styles.css" />
  <link rel="stylesheet" href="../assets/site-design.css" />
</head>
<body class="student-ui site-ui example-page">
  <header class="site-topbar">
    <div class="site-topbar__inner">
      <a class="home-brand" href="../index.html" aria-label="ExPassway">
        <span class="home-brand__mark" aria-hidden="true">E</span>
        <span data-i18n="homeBrand">ExPassway</span>
      </a>
      <div class="site-header-controls">
        <button id="backHome" class="btn-secondary" type="button" data-i18n="backHome">返回首页</button>
      </div>
    </div>
  </header>

  <main class="container">
    <section class="card" aria-labelledby="exampleTitle">
      <h1 id="exampleTitle" data-i18n="exampleTitle">页面标题</h1>
      <p class="tip" data-i18n="exampleDescription">页面说明</p>
      <label>
        <span data-i18n="exampleFieldLabel">字段</span>
        <input type="text" />
      </label>
      <div class="actions">
        <button class="btn-primary" type="button" data-i18n="save">保存</button>
      </div>
      <p role="status" aria-live="polite"></p>
    </section>
  </main>

  <script src="../scripts/i18n.js"></script>
  <script src="../scripts/site-ui.js"></script>
</body>
</html>
```

注意：实际提交时必须沿用仓库当前的版本化 cache key 策略；修改共享 CSS 后，要刷新所有消费页面对应资源的版本参数，避免生产边缘缓存继续返回旧文件。

---

## 25. 组件选择速查

| 需求 | 必须优先选择 | 默认物理状态 |
| --- | --- | --- |
| 页面主要提交 | `.btn-primary` | raised accent |
| 次级命令 | `.btn-secondary` | raised neutral |
| 标题栏图标 | `.site-header-control` | flat |
| 标题栏文字命令 | `.site-header-command` / `.home-nav-button` | flat |
| 文本输入/选择 | 原生 `input/select/textarea`，位于 `.site-ui` | inset |
| 二元设置 | `.setting-toggle` | inset track |
| 互斥大选项 | `.mode-option-card` + radio | flat / selected inset |
| 小型分段 | `.chapter-mode-switch` + `.is-active` | flat / selected inset |
| 页面主表面 | `.card` / `.panel` | raised / glass |
| 题目输入区 | `.option-item` | inset |
| 标准对话框 | `.profile-dialog` | elevated |
| 高密度详情对话框 | `.admin-detail-dialog` | high-opacity elevated |
| 横向宽表 | `.table-wrap` | internal horizontal scroll |
| 成功/错误消息 | `.good` / `.bad` | semantic text + live region |
| LCD / 计时器 | 现有 LCD token / `#timerDisplay` 结构 | inset readout |

若速查表中已有组件，禁止先写新 CSS；必须先用现有 class 实现，再仅为页面独有布局补充最小规则。

---

## 26. 开发与验收流程

### 26.1 实现前

- 确认页面属于普通站点、公开登录还是管理员登录边界。
- 搜索是否已有相同语义组件；优先复用当前 DOM/class。
- 明确每个表面是 flat、raised 还是 inset。
- 列出需要保留的 DOM ID、i18n key、事件和 API 行为。
- 若现有设计本身出现冲突，先记录并说明，不静默选择一套新样式。

### 26.2 代码检查

- 所有新色值是否来自令牌或批准的上下文色。
- 是否保持 `styles.css` 在前、`site-design.css` 在后。
- 是否使用 `site-ui` 作用域，避免污染认证页或旧工具。
- 浅色是否完全关闭普通表面的 backdrop blur。
- 暗色玻璃是否同时有填充、边、顶部高光、blur 和投影。
- 标题栏最终三态是否仍由文件末尾规则获胜。
- 禁用、focus、active、expanded、selected、error、success 是否完整。
- 是否出现卡片套卡片、普通页面水平滚动或透明叠字。

### 26.3 必测矩阵

每个新增或修改页面至少验证：

| 主题 | 桌面 | 移动 |
| --- | --- | --- |
| 浅色 | 1440 × 900 或等效 | 390 × 844 或等效 |
| 暗色 | 1440 × 900 或等效 | 390 × 844 或等效 |

此外必须验证：

- 中文与英文长文案；
- 键盘 Tab 顺序和 focus-visible；
- hover、active、selected/open、disabled；
- 对话框打开、内部滚动、关闭和焦点恢复；
- 移动菜单、toast、宠物气泡不重叠；
- 页面无普通横向滚动；
- 200% 缩放下关键流程可用；
- `prefers-reduced-motion`；
- 控制台无应用错误，资源无 404；
- `git diff --check`；
- 相关窄测试和 `npm run cloudflare:build`。

### 26.4 生产与缓存边界

- 本地文件修改不等于 GitHub 已同步。
- GitHub `main` 更新不等于 Cloudflare 已部署。
- Cloudflare 新版本存在不等于生产 100% 流量已经切换。
- 构建通过不证明浏览器视觉正确。
- 修改版本化 CSS/JS 后必须刷新消费页面 cache key，并验证生产 HTML 引用了新 key、生产资源内容与源文件一致。
- 交付说明必须分别陈述：本地修改、测试、提交/推送、部署、生产验证；未执行的步骤不得暗示已完成。

---

## 27. 规范维护

- 新增全局颜色、圆角、阴影、断点或组件状态前，必须先修改本规范和共享设计令牌。
- 页面级特例必须说明业务原因、适用选择器和不能扩散的边界。
- 删除或重命名预设 class 时，必须检索所有消费页面和动态 JavaScript 模板。
- 每次设计系统变更都要追加带完整时区的开发日志，并记录验证范围。
- 规范版本应与完成验证的代码快照关联；不能把尚未实现的设计想法写成现行强制标准。

---

## 28. 当前已知例外与迁移原则

1. `pages/admin-login.html` 仍由共享 `styles.css` 的认证样式独立维护；它不是新页面模板。公开登录页 `pages/login.html + assets/login.css` 才是未来认证视觉基准。
2. `assets/styles.css` 包含大量旧页面级规则和历史颜色。只要页面加载 `.site-ui`，材质与状态应由后加载的 `site-design.css` 获胜；不得从旧基础规则复制视觉值。
3. `.admin-detail-dialog` 的 `8px` 圆角和高不透明度是高密度、可读性优先的工具例外。
4. 错题本浮层与分页条使用实体背景，是为了阻止下层滚动文字透出，不得机械替换成 7% 玻璃。
5. 暗色试题原图保持浅色实体底，是考试内容可读性的必要例外。

后续发现新的不一致时，应优先收敛到本规范的共享令牌和组件，不得通过再增加一套页面专属设计系统来解决。
