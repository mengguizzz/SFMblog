# 致谢与第三方素材

这个站里**属于别人的东西**都列在这儿，包括出处和授权。

---

## 一、看板娘模型（重点看这条）

| | |
| --- | --- |
| 模型 | 《魔女之旅伊雷娜live2d》 |
| 作者 | **MNDIA** |
| 配布页 | <https://www.aplaybox.com/details/model/0MAXIOhAZAUw>（模之屋 / Aplaybox，2023-01-04） |
| 包内文件名 | `LSS1.1_by_MNDIA.zip`，所以资源都叫 `LSS.*` |

**作者在配布页写明的规则**（这是能不能用的唯一依据）：

| 规则 | 说明 |
| --- | --- |
| 禁止商用 | ❗不能用于任何商业用途 |
| 允许二次配布 | 可以转载 / 打包分发 |
| 允许修改模型 | 可以修改 |
| 使用无需书写完整借物表 | 不强制（本站还是写了） |
| 允许用于制作视频之外的用途 | 网页这类用途也可以 |

> 角色「伊蕾娜」出自《魔女之旅》（作者：**白石定規** / 插画：**あずーる**），
> 角色本身的版权归原作者与出版方，模型属于粉丝二创。
> 本站是**非商业的个人博客**，符合作者的配布规则。
> **如果你要拿去商用，必须另外联系 MNDIA 取得授权。**

本仓库对该模型的改动只有两处：把 `LSS.model3.json` 改名为 `index.json`、
把贴图从 4096×2048 压到 1024×512（其余文件原样保留）。

---

## 二、前端库

| 名称 | 用在哪 | 许可证 | 出处 |
| --- | --- | --- | --- |
| [live2d-widgets](https://github.com/stevenjoezhang/live2d-widgets) v1.0.1 | 看板娘组件本体（`src/live2d/widget/`） | MIT | stevenjoezhang |
| [marked.js](https://github.com/markedjs/marked) v12 | Markdown 渲染（CDN） | MIT | markedjs |
| [highlight.js](https://github.com/highlightjs/highlight.js) v11.9 | 代码高亮（CDN） | BSD-3-Clause | highlightjs |
| [Font Awesome Free](https://fontawesome.com/) v6.7.2 | 看板娘工具条的图标（内联 SVG） | 图标 CC BY 4.0 / 字体 SIL OFL 1.1 / 代码 MIT | Fonticons, Inc. |

### Live2D 运行时

| 文件 | 说明 |
| --- | --- |
| `live2dcubismcore.min.js` | **Live2D Cubism Core**，版权归 **Live2D Inc.**，按 Live2D Cubism SDK 的发布许可随 SDK 分发 |
| `live2d.min.js`、`chunk/index.js`、`chunk/index2.js` | live2d-widgets 的 Cubism 2 / Cubism 5 模型加载器 |

组件与模型**全部自托管**，站点运行时不会去请求任何第三方域名。

---

## 三、外部接口

| 服务 | 用途 | 说明 |
| --- | --- | --- |
| [hitokoto.cn](https://hitokoto.cn/)（一言） | 看板娘工具条上的「一言」按钮 | 免费公共接口。**只有访客点了那个按钮才会请求**，是全站唯一的第三方请求；取不到时用本地诗词兜底 |

## 四、字体与图标

界面本身不加载任何 Web 字体，用的是系统字体栈（`system-ui` 等），
因此不涉及字体授权问题。图标除了上面提到的 Font Awesome 之外都是内联 SVG。

## 五、本项目的由来

第一版由 **Gemini** 生成，整体设计思路参考了 [Docsify](https://docsify.js.org/) 的"单页 + Markdown"路线。
现在的版本在这套"零数据库 / 单文件 Markdown"思路上重做了界面与交互，
并重写了后端接口、评论系统与安全相关部分。

---

## 附：如果你是上面某位作者

如果你认为这里的用法超出了你的授权范围，请开一个 Issue 或直接联系我，
我会立刻下架相关内容。
