# dsh-subagent-injection（子智能体注入）

一个 DSH Web 插件：在**设置 → 内置插件**里增加一页「子智能体注入」，用一张可拖动排序的路由表决定主代理委派
子智能体时使用的 provider / model / 推理强度，注入在 `subagent` 调用真正执行之前完成，路由失败自动顺位重试。

**分类**：开发效率 / 模型与推理配置　**使用场景**：子智能体委派、多模型路由与降级、推理强度固定、关闭 `subagent_fork`

## 安装

```sh
dsh plugin --profile <你的 profile> add dsh-subagent-injection
```

重启 `dsh web`（或桌面端），打开 **设置 → 内置插件 → 子智能体注入** 即可配置。仓库名与包名同为
`dsh-subagent-injection`；`dsh plugin add` 也接受 Git 地址、tarball 与本地路径。

**需要 DSH 0.2.0-rc.2 或更新版本**（`package.json` 的 `engines.dsh` / `dsh.engines.dsh` 声明为
`>=0.2.0-rc.2 <0.3.0`，宿主更旧时请先升级 DSH）。

## 它解决什么

DSH 自带的 `subagent` 工具接受 `provider` / `model` / `reasoning_effort` 参数，但**必须由主代理自己决定**
要不要传、传什么。本插件把这件事从提示词里搬到界面上：

1. 设置页维护一张**有序路由表**，每行是一个 provider + model + 推理强度。
2. 主代理每次调用 `subagent`，插件都会在工具真正执行前把参数改写为路由表中的候选，顺序即优先级；
   主代理不需要被提示词提醒 —— 它自己传不传参数都一样。
3. 某个候选因为**路由本身的问题**失败（provider 不可达、密钥被拒、模型不存在、限流、5xx…），自动换下一个候选，
   只有整张表都失败才报错，并把每次失败的原因列出来。
4. `subagent_fork` 开关：取消勾选后该工具被禁用，调用会被**自动改派为 `subagent`**（而不是报错）。

## 界面

**设置 → 内置插件 → 子智能体注入**：

| 控件 | 作用 |
| --- | --- |
| 启用调度 | 总开关。关闭后插件完全不介入任何工具调用。 |
| 允许 subagent_fork | 见上文第 4 条。 |
| 路由表 | 每行：`⠿` 拖动柄、序号、provider、model、推理强度。 |
| 推理强度 | **仅当该模型声明了推理强度时才显示**；未声明的模型没有这一列，也不会注入 `reasoning_effort`。 |
| 刷新 / 保存 | 保存直接写回 profile 的 `cordis.patch.yml`，**无需重启**即可生效。 |

推理强度档位读的是**运行中的模型目录**（`llm.resolveModelInfo` 的结果），不是 `cordis.yml` 里的原始配置，
所以界面里出现的档位一定是适配器真正接受的那些。

## 配置

保存后写进 profile 的 `cordis.patch.yml`，也可以直接编辑（改配置热生效，不用重启）：

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

## 隐私与权限

- 宿主端只读 `ctx.config` 与被注入的模型目录，只注册一个 `tools/execute` 监听器；不发起任何网络请求，不读写文件，
  不访问环境变量，不执行动态代码，也没有安装脚本。
- 浏览器端是自注册 bundle（无构建步骤），只通过 `remote.settings` 的 `describe` / `update` 读写本插件自己的配置项。
- 唯一被写入的位置是当前 profile 的 `cordis.patch.yml` 里本插件的条目。

## 文档与许可

完整的开发文档（目录结构、测试、发布规则、实现要点）见仓库 README：
<https://github.com/Minhyuin/dsh-subagent-injection#readme>

MIT © 2026 Minhyuin · 许可证全文见本包的 [LICENSE](./LICENSE) 或仓库根目录的
<https://github.com/Minhyuin/dsh-subagent-injection/blob/master/LICENSE>。
