# dsh-reader

基于 DSH（DeepSeek Harness）的阅读器：**书在中间，Agent 对话在右栏**。

## 启动

```bash
./bin/setup-profile.sh
dsh --profile reader
```

第一次先跑 `setup-profile.sh`，它会在 `~/.dsh/profiles/reader` 建好 profile，并链接 `plugin/`。之后改插件代码不用重跑。

## 用法

- 把 TXT 放进 `library/`（原文不进 git）。
- 新建或打开一个会话，点顶部「打开书库」选书。**一个会话对应一本书**，阅读位置随会话保存。
- 打开书后，原生对话自动移到右栏「对话」标签；点「合上」回到普通对话。
- 手机上右栏会全屏，所以不会自动弹出对话，点「对话」才打开。

阅读会话单独存放在 `~/.dsh/profile-data/reader/`，不会混进你其他 DSH profile 的会话列表。

## 原理

- 中栏：插件以更高优先级（`priority: -10`）覆盖 ui-conversation 的 `main.conversation` 座位。没开书的会话照常渲染原生对话。
- 右栏：注册一个侧栏标签类型，标签里渲染 `conversation.content` 工厂的 `embedded` 版本。这和 DSH 子 Agent 侧栏对话用的是同一套机制。
- 每个会话只有一个输入框编辑器（Lexical），同一时刻只能挂在中栏或右栏其中一处。所以绑定状态还没读到时中栏什么都不渲染；合上书时先关掉右栏标签，再让中栏接管。
- 宿主侧：`/api/dsh-reader/*` 路由负责读书库、按「第X章」等标题分章、保存会话与书的绑定（`data/sessions.json`）。

## 已知限制（原型）

- 只支持 TXT；分章只用规则，没有 Agent 兜底。
- 右栏宽度沿用 DSH 默认（首次打开占 45%），需要手动拖动调窄。
- Agent 还读不到当前在看的书，阅读工具还没接。
