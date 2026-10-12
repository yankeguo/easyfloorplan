# 易户型

纯前端的户型图编辑器。先填横向、纵向间隔，生成参考线，再只在交叉点之间画墙。

长度单位是毫米。墙厚固定 120 mm，门洞固定 800 mm。

## 用法

需要 [Bun](https://bun.sh)。

```sh
bun install
bun run dev
```

浏览器打开 <http://localhost:3000>。

```sh
bun test        # 测试
bun run check   # 类型检查
bun run build   # 生成 dist/index.html
```

`dist/index.html` 把样式和脚本都内联在一份文件里，可以双击打开。

推送到 `main` 后，GitHub Actions 会构建并发布到 GitHub Pages：<https://yankeguo.github.io/easyfloorplan/>。仓库的 Pages 设置里，源要选 **GitHub Actions**。

## 能做什么

- 编辑开间和进深，拖动重排，或把一段拆成两段。多条序列交叉后结算成一组间隔。
- 在交叉点之间画墙、擦墙。连续的墙会连成一整段。
- 在墙上留门洞，标窗和推拉门，把地板标成飘窗，给房间命名。
- 墙围起来的区域才铺房间底色。能通到图外的格子留空。
- 撤销和重做。当前图会记在浏览器里。
- 保存、载入 JSON。文件版本是 3。
- 导出 PNG 和 SVG。导出图带开间、进深、总尺寸和图例，不标参考点编号。

## 许可

[MIT License](LICENSE)。Copyright (c) 2026 Y.-K. Guo。
