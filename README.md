# 沉浸式翻译&学习

这是 **沉浸式翻译&学习** 的 skills.sh / GitHub 仓库模板，同时包含浏览器扩展源码。

当前浏览器扩展版本：**V0.9.2**

## 两种“安装”不是一回事

### 1. 使用浏览器扩展

`extension/` 是 Chrome / Edge Manifest V3 源码。

发布时建议把它打成 ZIP 放到 GitHub Releases。用户解压后，在：

- Chrome: `chrome://extensions/`
- Edge: `edge://extensions/`

打开开发者模式并“加载已解压的扩展程序”。

### 2. 安装 Agent Skill

skills.sh 安装的是 `SKILL.md` 这个 Agent Skill，它用于让 Codex / Claude Code / Cursor / Windsurf 等 Agent 更稳定地维护、修改、排查和打包这个项目。

仓库发布后，安装命令是：

```bash
npx skills add <你的GitHub用户名>/immersive-translate-learning
```

## 发布到 skills.sh

1. 在 GitHub 新建公开仓库：`immersive-translate-learning`
2. 把本 ZIP 的全部内容上传到仓库根目录。
3. Push 到默认分支（通常 `main`）。
4. 本机执行一次：

```bash
npx skills add <你的GitHub用户名>/immersive-translate-learning --global --yes
```

skills.sh 的榜单由 `skills` CLI 的匿名安装遥测驱动；仓库被真实安装后会自动被发现并计入目录/排行。

## 后续更新

以后继续改代码时，只要继续 push 到同一个 GitHub 仓库即可。

使用者可运行：

```bash
npx skills update
```

拉取更新。

## 注意

- 不要把任何真实 API Key 提交到 GitHub。
- 当前项目仍在快速迭代阶段，适合先以 `0.x` 版本公开。
- 浏览器扩展的真正面向普通用户分发，后续更适合 GitHub Releases / Chrome Web Store / Edge Add-ons。
