# 全站背景双分辨率升级设计

## 目标

将首页和内页背景升级为适合普通屏幕与高分屏的双分辨率本地资源，在提升清晰度的同时避免手机无条件下载 4K 图片。保持 Hexo 7.3、Redefine 2.9、现有页面结构、暗色模式、透明度和 GitHub Actions 构建方式不变。

本次只调整背景素材及其加载逻辑，不修改头像、文章封面、正文内容或主题包 `node_modules`。

## 页面与素材分配

每类页面使用不同背景，文章页背景不再读取 Open Graph 图片，避免与文章封面重复。

| 页面 | 标准文件 | 4K 文件 | 原图与来源 |
| --- | --- | --- | --- |
| 首页场景一 | `miku-field.webp` | `miku-field-4k.webp` | 现有 1920 x 1080 原图；来源沿用 `sources.json` |
| 首页场景二 | `morning-mountains.webp` | `morning-mountains-4k.webp` | 现有 1920 x 1080 原图；来源沿用 `sources.json` |
| 首页场景三 | `river-sunrise.webp` | `river-sunrise-4k.webp` | 现有 1920 x 1152 原图；来源沿用 `sources.json` |
| 分类页 | `category-library-glow.webp` | `category-library-glow-4k.webp` | Tadokiari，8736 x 4896；https://wall.alphacoders.com/big.php?i=1317278 |
| 标签页 | `tag-cloud-city.webp` | `tag-cloud-city-4k.webp` | 云瀑城邦，4000 x 1857；https://safebooru.org/index.php?page=post&s=view&id=7085343 |
| 归档页 | `archive-star-bay.webp` | `archive-star-bay-4k.webp` | 星湾灯火，4000 x 2500；https://safebooru.org/index.php?page=post&s=view&id=7009209 |
| 文章页 | `article-digital-library.webp` | `article-digital-library-4k.webp` | 数字文库，7200 x 4050；https://safebooru.org/index.php?page=post&s=view&id=6716883 |
| 关于页 | `about-sky-terminal.webp` | `about-sky-terminal-4k.webp` | 晴空终端，5910 x 2944；https://safebooru.org/index.php?page=post&s=view&id=6507788 |

分类、标签、归档、文章和关于页的子路径沿用各自页面类型的背景。首页三张轮播图不在内页复用。当前文章封面 `firefly-side.webp` 继续只作为文章封面使用，当前头像继续只作为头像使用。

## 图片处理

每张背景输出两档 WebP：

- 标准版最长边约 1920 像素，目标不超过 450 KB。
- 4K 版宽度约 3840 像素，目标不超过 1.2 MB。
- 原生宽度达到 3840 像素的内页素材直接从原图缩放，不先经过现有低分辨率 WebP。
- 首页三张原图最高只有约 1920 像素，使用临时 AI 超分工具生成 2 倍版本；超分工具不写入项目依赖，也不参与网站运行。
- AI 超分工具和模型只放在临时目录。若当前环境无法运行模型，或输出出现人物、文字和线条失真，不得用普通插值冒充 AI 超分；须保留现有首页文件并在正式接入前报告。
- 不以明显色带、文字破碎或人物五官损坏换取文件大小。若个别 4K 文件必须超过目标上限，须在来源记录中说明实际大小与原因。

所有正式页面只引用 `source/images/brand/` 中的本地文件。`source/images/brand/sources.json` 为每个槽位记录标准文件、4K 文件、来源页、原始尺寸和处理方式。页面运行时不请求图片源站。

## 响应式加载

首页轮播继续使用现有场景和切换交互，但每个场景同时提供 1920 与 3840 地址。脚本为横幅图片设置 `src`、`srcset` 和 `sizes="100vw"`，由浏览器按实际显示宽度选择资源。

内页背景不能直接依赖 `image-set()`，因为高像素密度手机可能因此下载 4K。场景映射为每个页面返回 `image` 与 `image4k`，初始化脚本按以下条件选择：

```text
视口宽度至少 2560
或
视口宽度至少 1200，并且 视口宽度 x devicePixelRatio 至少 2560
```

其他情况使用标准版。窗口跨越资源档位时，经防抖后更新一次背景；档位未变化时不重复替换。标准版作为初始值，确保脚本执行前页面也不会出现空白背景。

## 视觉与透明度

本次沿用当前正式透明度，不降低遮罩来突出新图：

- 浅色页面遮罩：顶部 `0.74`，向下到 `0.91`。
- 浅色导航：`0.82`；内容卡片：`0.90`。
- 暗色页面遮罩：顶部 `0.72`，向下到 `0.91`。
- 暗色导航：`0.84`；内容卡片：`0.90`。
- 首页导航保持透明，首页横幅继续使用现有独立渐变。

每张内页图分别配置桌面和手机焦点。文章页数字文库与关于页晴空终端优先保留人物面部；标签与归档页优先保留主要建筑、瀑布、海湾和灯火；分类页继续保留暖金人物与图书馆光源。

## 代码边界

- 修改 `source/js/anime-page-scenes.js`，为内页场景添加标准与 4K 地址，并让文章页固定使用数字文库背景。
- 修改 `source/js/anime-theme.js`，实现首页 `srcset` 和内页资源档位选择。
- 仅在确有需要时调整 `source/css/anime-theme.css` 中的焦点变量；透明度数值保持不变。
- 更新 `source/images/brand/sources.json` 和相关测试。
- 不修改 `node_modules`，不新增后端、数据库、远程图片 API 或运行时第三方依赖。

## 验证

- 检查全部标准与 4K 文件可解码，尺寸符合各自档位，文件大小满足目标或记录例外。
- 单元测试断言首页和五类内页的标准/4K映射正确，页面背景路径互不重复，文章页不再读取文章 Open Graph 图片作为背景。
- 在普通桌面、2 倍高分桌面、4K 桌面和高像素密度手机中记录实际图片请求，确认手机与普通 1080p 屏幕不下载 4K。
- 使用 Playwright 检查 `1440 x 1000`、`390 x 844` 以及高分屏视口；确认人物面部和主要场景焦点可见，文本无重叠，页面无横向溢出。
- 检查浅色、暗色和低动态偏好，确认透明度与现有值一致、移动导航正常。
- 检查所有图片 `naturalWidth > 0`，页面不存在失效的本地资源或运行时外链图片。
- 执行 `npm run clean` 和 `npm test`，确认 Hexo 构建、MathJax、RSS、搜索、字数统计和 GitHub Actions 契约不回归。
