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

## 模型（`model/Hiyori/`）

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
