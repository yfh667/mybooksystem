# quarto-knowledge-tool

一个本地 Quarto Book 知识管理工作流，把 Quarto + Positron/VS Code + 浏览器预览串起来。**这个仓库只放工具脚本本身**，不放笔记内容。

## 它能做什么

- **文件夹优先的内容组织**：每一节内容都是 `<name>/<name>.qmd`
- **保存即编译**：写 `.qmd` 自动渲染 HTML，后台自动编译 PDF
- **实时预览**：HTML 在浏览器/Simple Browser 自动刷新；PDF 用 PDF.js 渲染、自动 reload、保留页码
- **Ctrl+Click 反查源码**：在 HTML 预览里 Ctrl+Click 段落 → Positron 自动跳到对应 `.qmd` 文件那一行
- **粘贴图片自动归档**：在 .qmd 里粘贴的图片自动落到当前 .qmd 同级的 `images/` 文件夹

## 安装

把这个仓库 clone 到你的 Quarto book 项目根目录下的 `tool/` 子文件夹里：

```bash
cd <your-quarto-book>
git clone https://github.com/<you>/quarto-knowledge-tool tool
```

然后在你的 `_quarto.yml` 里加上：

```yaml
format:
  html:
    include-in-header:
      - tool/autoreload.html
```

启动：双击 `tool/start.cmd`，浏览器打开 `http://localhost:4321/split`。

## 依赖

- **Windows**（脚本用了 PowerShell + .cmd；其它平台需要移植）
- **Quarto** ≥ 1.4（在 PATH 里，或修改 `tool/watch-render.ps1` 里的 `$quartoExe`）
- **Node.js** ≥ 16（用于 `serve.js` 和 `gen-includes.js`）
- **Positron** 或 **VS Code** —— Ctrl+Click 反跳源码依赖 `positron.cmd` 或 `code.cmd`（修改 `serve.js` 里的 `POSITRON_CLI`）
- **TeX Live / MiKTeX**（仅当需要 PDF；项目用 xelatex + xeCJK 处理中文）

---

## 项目目录约定

工具假设你的 Quarto book 项目长这样：

```
my-book/
├── index.qmd                            ← Quarto 必须在根
├── _quarto.yml
├── references.bib
├── .vscode/                             (Positron 工作区设置)
├── qmd/                                 ← 所有内容
│   ├── chapter1/
│   │   ├── chapter1.qmd
│   │   ├── section-a/
│   │   │   ├── section-a.qmd
│   │   │   └── images/                  (粘贴图片自动归档到这里)
│   │   └── section-b/
│   │       └── section-b.qmd
│   └── chapter2/...
├── tool/                                ← 本仓库（git submodule 或 clone）
└── _book/ _pdf/                         ← 输出，gitignore
```

### 一句话规则

**任何内容单元 `X` 都是 `X/X.qmd`。要给 `X` 加子节 `Y`，就在 `X/` 里建 `Y/` 文件夹，里面放 `Y/Y.qmd`。**

### 例子

想给 chapter1 章节加一个"概述"小节：

```bash
mkdir -p qmd/chapter1/overview
echo "## Overview" > qmd/chapter1/overview/overview.qmd
```

下次保存任意 `.qmd`，watcher 跑 `gen-includes.js` 会自动在 `chapter1.qmd` 末尾插入：

```markdown
<!-- AUTO-INCLUDES-BEGIN -->
{{< include overview/overview.qmd >}}
<!-- AUTO-INCLUDES-END -->
```

子节顺序按文件夹名字母序。要固定就用前缀：`01-overview/01-overview.qmd`。

### 添加章节

1. 在 `qmd/` 下建 `<chapter>/<chapter>.qmd`
2. 在 `_quarto.yml` 的 `book.chapters` 列表里加 `qmd/<chapter>/<chapter>.qmd`

---

## 用法

### 启动 / 关闭

| 操作 | 怎么做 |
|------|--------|
| 启动 | 双击 `tool/start.cmd` |
| 关闭 | 双击 `tool/stop.cmd` |
| 看实时日志 | `Get-Content watcher.log -Wait -Tail 20` |

### 预览 URL

在 Positron `Ctrl+Shift+P` → `Simple Browser: Show`，或者外部浏览器：

| URL | 内容 |
|-----|------|
| `http://localhost:4321/` | 书首页（Preface），左侧 sidebar 可导航 |
| `http://localhost:4321/qmd/<ch>/<ch>.html` | 直接进某章 |
| `http://localhost:4321/pdf` | PDF.js 完整预览（带导航、缩放、目录） |
| `http://localhost:4321/split` | **二合一面板**：左 HTML 右 PDF，中间可拖拽分隔 |

### 快捷键

| 操作 | 按键 | 效果 |
|------|------|------|
| 保存 .qmd | `Ctrl+S` | watcher 自动重新渲染 |
| HTML 反查源码 | **`Ctrl+Click`** 任意段落/标题 | Positron 跳到对应 .qmd 那一行 |

---

## 涉及文件

| 文件 | 作用 |
|------|------|
| `start.cmd` / `stop.cmd` | 启动 / 关闭脚本 |
| `watch-render.ps1` | 文件监听 → gen-includes → quarto render HTML → quarto render PDF |
| `serve.js` | Node HTTP 服务器（端口 4321），提供：<br>`/` `/qmd/*`：serve `_book/`<br>`/pdf`：PDF.js viewer 外壳<br>`/_pdf/test.pdf`：serve `_pdf/test.pdf`<br>`/_pdfjs/*`：serve `_pdfjs/` 静态文件<br>`/split`：HTML+PDF 二合一面板<br>POST `/find-source`：根据文本搜源文件位置<br>POST `/open-in-editor`：用 Positron CLI 跳到那一行 |
| `gen-includes.js` | 扫描 `qmd/` 树，自动生成每章的 `{{< include >}}` 块 |
| `autoreload.html` | 注入到每个 HTML 的脚本：(1) 轮询变化自动 reload；(2) Ctrl+Click 反查源码 |
| `_pdfjs/` | Mozilla PDF.js viewer 完整 dist（v3.11.174） |

---

## `_quarto.yml` 关键配置

```yaml
project:
  type: book
  output-dir: _book

book:
  title: "My Book"
  chapters:
    - index.qmd
    - qmd/chapter1/chapter1.qmd
    - qmd/chapter2/chapter2.qmd
    # …

bibliography: references.bib
csl: ieee.csl
link-citations: true
link-bibliography: true
suppress-bibliography: true              # 不在每章末尾追加文献

format:
  html:
    theme: cosmo
    toc: true
    number-sections: true
    search: true
    include-in-header:
      - tool/autoreload.html             # 关键：注入反查 + 自动刷新脚本
  pdf:
    pdf-engine: xelatex
    mainfont: "Times New Roman"
    documentclass: scrreprt
    include-in-header:
      text: |
        \usepackage{xeCJK}
        \setCJKmainfont{SimSun}
```

---

## 常见故障

### Watcher 死了 / 端口被占用

```powershell
Get-Process | Where-Object { $_.Name -match "quarto|deno|node" -and $_.Name -notmatch "node_repl" } | Stop-Process -Force
Remove-Item .watcher.lock -ErrorAction SilentlyContinue
```

然后双击 `tool/start.cmd` 重启。

### HTML 预览不刷新

- 确认 `_book/<file>.html` 在保存后**有更新**（看 mtime）
- 强制刷新 Simple Browser：右键 → Reload，或 `Ctrl+R`
- 看 `watcher.log` 是否报错

### PDF 预览不刷新 / 黑屏

- 强制刷新 `/pdf` 面板
- PDF.js viewer 自带在 `tool/_pdfjs/`，不需要外网
- 看 `_pdf/test.pdf` 是否生成

### Ctrl+Click 跳转 "source not found"

- 通常是文本太短或太特殊。代码会级联尝试 70/30/15/8/4 字符前缀
- 公式、引用编号、跨页脚注这种"非纯文本"元素跳不动是预期内的
- 点击它周围的纯文本通常能找到

### PDF 渲染失败（xelatex 报错）

- **不要**手动跑 `quarto render --to pdf`（会清空 `_book/` 里的 HTML）
- watcher 用 `--output-dir _pdf` 单独输出，不冲突
- 不要用 Positron 侧边栏的"Preview Format > PDF"按钮，会和 watcher 抢资源

### `_quarto.yml` 报错 "must include a home page"

`index.qmd` 必须在项目根目录（不能放到 `qmd/` 里）。这是 Quarto Book 的硬性限制。

---

## 设计决定备忘

| 决定 | 原因 |
|------|------|
| `index.qmd` 留在根目录 | Quarto Book 硬性要求 |
| 其他章节进 `qmd/<name>/<name>.qmd` | 文件夹优先约定，方便嵌套子节 |
| PDF 输出到 `_pdf/` 而非 `_book/` | `quarto render --to pdf` 会清空 output dir，分开避免冲掉 HTML |
| Watcher 用 PowerShell `FileSystemWatcher` 自己实现 | Quarto preview 自带的监听器在 Windows 上不可靠（Positron 原子保存不触发） |
| Node `serve.js` 替代 `quarto preview` | quarto preview 会用旧缓存覆盖刚渲染好的 HTML，导致竞态 |
| PDF.js viewer 用本地 `tool/_pdfjs/` 而非 CDN | Simple Browser 不能原生渲染 PDF；用 PDF.js 自定义包装层实现自动 reload 保留页码 |
| `Ctrl+Click` 走 server endpoint，不走 `positron://` URL | Simple Browser 的 webview 拦截非 http/https 协议 |

---

## 路线图

- [ ] 跨平台（去掉 Windows 路径硬编码）
- [ ] 抽离为 Positron / VS Code Extension
- [ ] HTML 侧栏增加"可 Ctrl+Click 反查"视觉提示
- [ ] `gen-includes` 支持手动排序（读取 `_order.yml`）
- [ ] WebSocket 推送 reload 替代客户端轮询

## License

MIT
