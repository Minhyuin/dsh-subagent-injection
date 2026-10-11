# dsh-subagent-injection（子智能体注入）

[![CI](https://github.com/Minhyuin/dsh-subagent-injection/actions/workflows/ci.yml/badge.svg)](https://github.com/Minhyuin/dsh-subagent-injection/actions/workflows/ci.yml)

一个 DSH Web 插件：在**设置 → 内置插件**里增加一页「子智能体注入」，用来集中配置主代理委派子智能体时使用的
provider / model / 推理强度，并按优先级顺序自动注入到 `subagent` 调用上，失败自动顺位重试。

## 它解决什么

DSH 自带的 `subagent` 工具本身接受 `provider` / `model` / `reasoning_effort` 参数，但**必须由主代理自己决定**
要不要传、传什么。本插件把这件事从提示词里搬到界面上：

1. 设置页维护一张**有序路由表**（可拖动排序），每行是一个 provider + model + 推理强度。
2. 主代理每次调用 `subagent`，插件都会在工具真正执行前把参数改写为路由表中的候选，顺序即优先级。
   主代理不需要被提示词提醒 —— 它自己传不传参数都一样。
3. 某个候选因为**路由本身的问题**失败（provider 不可达、密钥被拒、模型不存在、限流、5xx…），自动换下一个候选，
   主代理与用户都不需要干预；只有整张表都失败才会报错，并把每次失败的原因列出来。
4. `subagent_fork` 开关：取消勾选后该工具被禁用，调用会被**自动改派为 `subagent`**（而不是报错），
   因此仍然享受上面的路由顺序。

## 界面

**设置 → 内置插件 → 子智能体注入**：

| 控件 | 作用 |
| --- | --- |
| 启用调度 | 总开关。关闭后插件完全不介入任何工具调用。 |
| 允许 subagent_fork | 见上文第 4 条。 |
| 路由表 | 每行：`⠿` 拖动柄、序号、provider、model、推理强度。 |
| 推理强度 | **仅当该模型声明了推理强度时才显示**；未声明的模型没有这一列，也不会注入 `reasoning_effort`。 |
| 刷新 / 保存 | 保存直接写回 profile 的 `cordis.patch.yml`，**无需重启**即可生效。 |

候选模型与推理强度**不读 `cordis.yml` 的原始配置，而是读运行中的模型目录**
（`session/modelCatalog`，即 `llm.resolveModelInfo` 的结果），所以界面里出现的档位一定是适配器真正接受的那些；
未声明的模型不会显示推理强度选择器。保存时还会丢弃"上一个模型残留的、当前模型并不支持的"推理强度。

## 安装

以 bundle 形式装进 profile（这里的例子是 `desktop`）：

```jsonc
// C:\Users\User\.dsh\profiles\desktop\package.json
{
  "dependencies": { "dsh-subagent-injection": "link:<本仓库>/plugin" },
  "dsh": { "profile": { "bundles": [ /* …, */ "dsh-subagent-injection" ] } }
}
```

`<本仓库>/plugin` 需要有一条同名 Junction/软链到 `node_modules`，或者用 `plugin_manager` 的 bundle 安装完成这两步。
装载后 profile 的 `cordis.patch.yml` 里会出现本插件的条目，设置页的保存也写在同一个条目上：

```yaml
- id: subagent-injection
  name: dsh-subagent-injection
  config:
    enabled: true
    fork: false
    routes:
      - provider: pioneer
        model: deepseek-v4.1-flash
      - provider: deepseek
        model: deepseek-flash
        effort: max
```

## 为什么改代码之后要分别重启

DSH 的 HMR 只监听 profile 的 `cordis.patch.yml` 与 `package.json`，**插件源码不在监听范围内**：

- **改配置**（设置页保存、直接编辑 `cordis.patch.yml`）→ 立即热生效，不用重启。
- **改宿主端代码**（`plugin/lib/index.js`）→ 必须彻底退出 DSH 再打开；只关窗口或刷新页面不够
  （宿主端是 Node 侧 `require` 进来的，模块缓存跟随进程生命周期）。
- **改浏览器端代码**（`plugin/lib/client.js`）→ **刷新页面即可**。宿主每次请求都现读磁盘，并用
  `{mtimeMs, ctimeMs, size}` 算出 `rev` 做 URL 指纹。

## 目录

```
plugin/                 插件本体（profile 里 `link:` 的就是它）
  package.json          dsh.bundle.patch + dsh.client(platform: web)
  cordis.patch.yml      bundle 补丁：插入 id=subagent-injection 的条目
  lib/index.js          宿主端：tools/execute 监听器（注路由 + 失败顺位 + fork 改派）
  lib/client.js         浏览器端：自注册 factory bundle（无构建步骤，手写 jsx）
tools/                  开发期工具，不参与插件运行
  test-host.mjs         宿主端 18 项断言
  test-client.mjs       浏览器端 bundle 形状 / slot 契约 / 渲染 / 保存断言
  asar-map.mjs          asar 读取/解包/grep（读 DSH 上游源码用）
  asar-snip.mjs         在压缩过的 bundle 里打印正则命中附近的片段
```

本地验证：

```sh
npm install                   # 只为拿到宿主端 import 的 @deepseek-ai/schemastery（DSH 运行时本来就会提供）
node tools/test-host.mjs      # host: 18 checks passed
node tools/test-client.mjs    # client: bundle shape, slot contract, render and save checks passed
```

仓库本身没有构建步骤：两半都是手写纯 JS，客户端半边是自注册 bundle。唯一的安装项是 `schemastery`
（`Config` 的 schema 库），在 DSH 里它是 peer dependency。

CI（`.github/workflows/ci.yml`）在每次 push/PR 上跑这两条；`master` 上的推送由
`.github/workflows/release.yml` 按 Conventional Commit 自动打 tag 并创建 Release。

## 实现要点

- 宿主端只注册**一个** `ctx.on("tools/execute", …)` 监听器，这是 DSH 唯一允许在工具真正执行前观察并改写的扩展点。
  监听器通过改写 `exec.name` / `exec.schema` 实现 fork→subagent 改派，通过改写 `exec.arguments` 注入路由，
  并在每次尝试结束后还原。
- 路由优先级 = 数组顺序。若主代理自己指定了 provider/model，该选择会作为**第一个候选**先行尝试，
  失败后再按配置顺序顺位。
- 只有「路由类」失败才顺位重试；取消、工具自身 bug 等一律原样上报，避免重复副作用。
- 浏览器端是手写的 `window.__ModuleLoader__.load({ id, factory })` 自注册 bundle，只依赖
  `react` / `react/jsx-runtime` / `@deepseek-ai/dsh-client-ui-primitives`（都在 shell 的基线模块表里），
  所以不需要打包器；设置页通过 `settings.plugins.tab` 插槽挂进「内置插件」分区，读写走 `remote.settings`
  的 `describe` / `update`（远端一律返回 `{ok, value}` / `{ok, error}` 信封，客户端先拆信封再当数据用）。
