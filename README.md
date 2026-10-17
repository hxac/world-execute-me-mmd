# world.execute(me) - MMD

许愿式编程：采用模型 `deepseek v4.1 flash 1017`，在一个提示词

> 根据歌曲和歌词，设计网页（typescript）纯动效无角色 2D 的 MMD

完成所有构建。

**当前 DSH 版本**：DeepSeek Harness `0.2.1-rc.2`（桌面配置 / Web 图形界面，nightly 更新通道）。

**演示页面**：https://hxac.github.io/world-execute-me-mmd/

![开始界面](docs/preview-start.jpg)

```bash
npm install
npm run dev
```

---

## 价格说明

本项目生成与调试期间的模型用量及费用如下（人民币）：

| 项目 | 用量（tokens） | 单价（元/百万 tokens） | 费用 |
| :--- | ---: | ---: | ---: |
| 缓存读取 | 73,283,712 | 0.02 | **1.46567424 元** |
| 未缓存输入 | 197,106 | 1.00 | **0.197106 元** |
| 输出 | 395,145 | 4.00 | **1.58058 元** |
| **合计** | **73,875,963** | — | **3.24336024 元** |

## 许可协议

本项目原创的源代码、页面结构、交互逻辑和生成视觉设计采用 [MIT 许可证](LICENSE)。

- [完整中文许可协议](LICENSE)
- [第三方内容声明](THIRD_PARTY_NOTICES.md)
- [第三方字体许可说明](public/licenses/README.md)

歌曲、录音和歌词归 **Mili** 及相应权利方所有，不属于 MIT 许可证的授权范围。本项目是非官方、非商业粉丝作品，与 Mili 及相应权利方不存在隶属、授权或背书关系。
