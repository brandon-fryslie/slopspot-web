# ZAI MCP 服务器

[中文文档](https://docs.bigmodel.cn/cn/coding-plan/mcp/vision-mcp-server) | [English Document](https://docs.z.ai/devpack/mcp/vision-mcp-server)

一个基于 Z.AI 提供 AI 能力的模型上下文协议 (MCP) 服务器。

## 可用工具

该服务器提供针对不同图像和视频分析任务的专业工具：

### 图像分析工具

1. **`ui_to_artifact`** - 将 UI 截图转换为各种产物
   - 从设计稿生成前端代码
   - 创建用于 UI 重建的 AI 提示词
   - 提取设计规范文档
   - 生成 UI 的自然语言描述

2. **`extract_text_from_screenshot`** - OCR 文字提取
   - 从截图中提取代码（保持正确格式）
   - 提取终端输出和日志
   - 提取文档和文本内容
   - 支持编程语言提示以提高准确性

3. **`diagnose_error_screenshot`** - 错误诊断和故障排查
   - 分析错误消息和堆栈跟踪
   - 识别根本原因
   - 提供可操作的解决方案
   - 建议预防策略

4. **`understand_technical_diagram`** - 技术图表分析
   - 分析架构图
   - 理解流程图和 UML 图
   - 解释 ER 图和序列图
   - 识别设计模式

5. **`analyze_data_visualization`** - 数据可视化洞察
   - 从图表中提取洞察
   - 识别趋势和模式
   - 检测异常值
   - 提供业务影响分析

6. **`ui_diff_check`** - UI 对比检查（视觉回归测试）
   - 比较预期和实际的 UI 实现
   - 识别视觉差异
   - 提供详细的差异报告
   - 按严重程度排列问题优先级

7. **`analyze_image`** - 通用图像分析（兜底工具）
   - 当专业工具不适用时使用
   - 灵活理解任何视觉内容
   - 全面的图像描述和分析

### 视频分析工具

8. **`analyze_video`** - 视频内容分析
   - 理解视频内容和上下文
   - 从视频中提取关键信息
   - 分析视频结构和元素

## 环境变量

- `Z_AI_MODE` - 用于 AI 服务的平台（默认：`ZHIPU`）ZHIPU 或 ZAI
- `Z_AI_API_KEY` - 您的 API 密钥

对于 `Z_AI_MODE=ZHIPU`：使用智谱 AI 平台 https://bigmodel.cn

对于 `Z_AI_MODE=ZAI`：使用 ZAI 平台 https://z.ai/model-api 


## 安装

### 从 npm 安装

```bash
npm i @z_ai/mcp-server
```

## 使用方法

### 在 Claude Code 中使用此 MCP 服务器

```shell
claude mcp add zai-mcp-server --env Z_AI_API_KEY=your_api_key  -- npx -y "@z_ai/mcp-server"
```

### 在其他客户端中使用此 MCP 服务器

参考文档 [视觉理解 MCP](https://docs.bigmodel.cn/cn/coding-plan/mcp/vision-mcp-server)
