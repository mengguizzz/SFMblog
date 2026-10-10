# 这个目录里的素材来源

完整清单（含许可证）在仓库根目录的 **[CREDITS.md](../../CREDITS.md)**，这里只留最要紧的一句：

> `model/Elaina/` 是 **MNDIA** 配布的《魔女之旅》伊蕾娜 Live2D 模型，
> 出自 <https://www.aplaybox.com/details/model/0MAXIOhAZAUw>。
> 作者规则：**禁止商用**、允许二次配布、允许修改。角色版权归《魔女之旅》原作者与插画师。

`widget/` 是 [live2d-widgets](https://github.com/stevenjoezhang/live2d-widgets)（MIT）
加上 Live2D Inc. 的 Cubism 运行时，两者都自托管在本目录，运行时不会请求第三方域名。

**想换模型**：把模型目录放进 `model/<名字>/`（里面要有 `index.json` 和它引用的
`.moc` / `.moc3`、贴图、动作），再改上一层的 `model_list.json`，最后把
`js/blog.js` 里的 `MODEL_ID` 指到它。

> ⚠️ 换个下载站不等于没有版权问题。社区合集（比如 `fghrsh/live2d_api`）里很多是
> 游戏角色提取物，版权归各自原作者。省心的路只有三条：官方示例模型、自己捏、去 BOOTH 买。
