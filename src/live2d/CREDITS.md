# src/live2d 素材来源

这个目录里的东西**全部自托管**：跑起来不请求任何第三方域名，也不依赖 CDN。
所以要换成别的模型，或者想彻底删掉看板娘，直接动这里就行。

## 组件（`widget/`）

| 文件 | 来源 |
| --- | --- |
| `waifu.css` / `waifu-tips.js` / `waifu-tips.json` | [stevenjoezhang/live2d-widgets](https://github.com/stevenjoezhang/live2d-widgets) `1.0.1`（MIT） |
| `live2d.min.js` | 同上，Cubism 2 加载器 |
| `live2dcubismcore.min.js` | [Live2D/CubismWebFramework](https://github.com/Live2D/CubismWebFramework) 的 Cubism 5 核心 |
| `chunk/index.js` `chunk/index2.js` | 上面两套模型加载器（按体积拆过，方便按需下载） |

## 模型

仓库里自带两个模型，工具条上的「换模型」可以切换，改 `js/blog.js` 里的 `MODEL_ID`
（0 = 伊蕾娜，1 = Hiyori）可以改默认值。

### `model/Elaina/` —— 伊蕾娜（默认）

**《魔女之旅》伊蕾娜**，作者 **MNDIA**，原帖：

- 配布页：<https://www.aplaybox.com/details/model/0MAXIOhAZAUw>（模之屋 / Aplaybox，2023-01-04 发布）
- 包内文件名是 `LSS.*`（`LSS1.1_by_MNDIA.zip`），本目录只是把 `LSS.model3.json`
  改名为 `index.json`、贴图路径改了一下，其余文件原样保留

**作者在配布页写明的规则**（这是能不能用的依据）：

| 规则 | 说明 |
| --- | --- |
| 禁止商用 | ❗**不能用于任何商业用途** |
| 允许二次配布 | 可以转载 / 打包分发 |
| 允许修改模型 | 可以改 |
| 使用无需书写完整借物表 | 不强制要求写全套借物表（本站还是写了） |
| 允许用于制作视频之外的用途 | 不只是做视频，网页这类用途也允许 |

> 角色「伊蕾娜」出自《魔女之旅》（作者：白石定規 / 插画：あずーる），
> 角色本身的版权归原作者与出版社，模型是粉丝二创。
> **本站是非商业的个人博客**，符合作者的配布规则；如果你要拿去商用，得另外找作者授权。

贴图和 Hiyori 一样压过：4096×2048（1.9 MB）→ 1024×512（227 KB），显示尺寸只有 300px，看不出差别。
这个模型是 Cubism 5（`.moc3`），没有动作文件，所以它不会自己动，但有物理（头发 / 衣服会晃）和眨眼。

### `model/Hiyori/` —— Live2D 官方示例

**Live2D 官方示例模型 Hiyori**，来自 [Live2D/CubismWebSamples](https://github.com/Live2D/CubismWebSamples)
（`Samples/Resources/Hiyori`）。

- 依据 [Live2D 免费素材利用许偌](https://www.live2d.com/eula/live2d-free-material-license-agreement_cn.html) 使用
- 版权归 **Live2D Inc.** 所有
- `index.json` 就是官方的 `Hiyori.model3.json`（只改了文件名，方便组件按 `model/<名字>/index.json` 取）
- 贴图从 2048×2048 压到 1024×1024（4.3 MB → 1.1 MB）——看板娘显示尺寸只有 300px，肉眼无差别
- `textures.cache` 是两字节的空数组占位，组件会请求它，放这儿免得 404

## 想换模型

把新模型目录放进 `model/<名字>/`（里面要有 `index.json`，以及它引用的
`.moc` / `.moc3`、贴图、动作等），再改上一层的 `model_list.json`。
组件靠 `index.json` 里有没有 `Version === 3` / `FileReferences` 判断走
Cubism 5（`.moc3`）还是 Cubism 2（`.moc`）——**两套核心都已自托管**，不用联网取 SDK。

> ⚠️ 注意：**换个下载站并不等于没有版权问题**。
> 社区合集（如 `fghrsh/live2d_api`）里很多是游戏角色提取物，版权归各自原作者。
> 想省心就用官方示例模型、自己捏，或者在 BOOTH 之类的地方买一份带授权的。
