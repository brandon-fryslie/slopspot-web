# ZAI MCP Server

[中文文档](https://docs.bigmodel.cn/cn/coding-plan/mcp/vision-mcp-server) | [English Document](https://docs.z.ai/devpack/mcp/vision-mcp-server)


A Model Context Protocol (MCP) server that provides AI capabilities powered by Z.AI.

## Available Tools

This server provides specialized tools for different image and video analysis tasks:

### Image Analysis Tools

1. **`ui_to_artifact`** - Convert UI screenshots to various artifacts
   - Generate frontend code from designs
   - Create AI prompts for UI recreation
   - Extract design specifications
   - Generate natural language UI descriptions

2. **`extract_text_from_screenshot`** - OCR and text extraction
   - Extract code from screenshots with proper formatting
   - Extract terminal output and logs
   - Extract documentation and text content
   - Supports programming language hints for better accuracy

3. **`diagnose_error_screenshot`** - Error diagnosis and troubleshooting
   - Analyze error messages and stack traces
   - Identify root causes
   - Provide actionable solutions
   - Suggest prevention strategies

4. **`understand_technical_diagram`** - Technical diagram analysis
   - Analyze architecture diagrams
   - Understand flowcharts and UML diagrams
   - Explain ER diagrams and sequence diagrams
   - Identify design patterns

5. **`analyze_data_visualization`** - Data visualization insights
   - Extract insights from charts and graphs
   - Identify trends and patterns
   - Detect anomalies
   - Provide business implications

6. **`ui_diff_check`** - UI comparison for visual regression
   - Compare expected vs actual UI implementations
   - Identify visual discrepancies
   - Provide detailed difference reports
   - Prioritize issues by severity

7. **`analyze_image`** - General-purpose image analysis (fallback)
   - Use when specialized tools don't fit your needs
   - Flexible understanding of any visual content
   - Comprehensive image description and analysis

### Video Analysis Tools

8. **`analyze_video`** - Video content analysis
   - Understand video content and context
   - Extract key information from videos
   - Analyze video structure and elements

## Environment Variables

- `Z_AI_MODE` - The platform to use for AI services (default: `ZHIPU`)  ZHIPU or ZAI
- `Z_AI_API_KEY` - Your API key
 
For ZAI: Use ZAI platform https://z.ai/model-api

For ZHIPU: Use Zhipu AI platform https://bigmodel.cn

## Usage

### Use this MCP Server in Claude Code

It is recommended to use the version Node.js 18+, Claude Code 2.0.14+.

**Note**: You need to configure `Z_AI_MODE` as `ZAI` or `ZHIPU` depending on the platform.

For ZAI Use,

```shell
claude mcp add zai-mcp-server --env Z_AI_API_KEY=your_api_key Z_AI_MODE=ZAI -- npx -y "@z_ai/mcp-server"
```

For ZHIPU Use,

```shell
claude mcp add zai-mcp-server --env Z_AI_API_KEY=your_api_key Z_AI_MODE=ZHIPU -- npx -y "@z_ai/mcp-server"
```

### Use this MCP Server in Others MCP Client

For Z.ai Use, refer the [Vision MCP Doc](https://docs.z.ai/devpack/mcp/vision-mcp-server)

For ZhiPU Use, refer the [Vision MCP Doc](https://docs.bigmodel.cn/cn/coding-plan/mcp/vision-mcp-server)