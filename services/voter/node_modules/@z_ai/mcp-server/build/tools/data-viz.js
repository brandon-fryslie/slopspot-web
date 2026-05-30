import { z } from 'zod';
import { FileNotFoundError, ApiError } from '../types/index.js';
import { CommonSchemas, ToolSchemaBuilder } from '../utils/validation.js';
import { formatMcpResponse, createSuccessResponse, createErrorResponse, withRetry } from '../core/api-common.js';
import { BaseImageAnalysisService } from '../core/base-image-service.js';
import { DATA_VIZ_ANALYSIS_PROMPT } from '../prompts/index.js';
/**
 * Data Visualization Analysis service - Analyze charts and graphs
 */
class DataVizAnalysisService extends BaseImageAnalysisService {
    /**
     * Analyze data visualization
     * @param imageSource Image file path or URL
     * @param userPrompt User's question about the visualization
     * @param analysisFocus Optional focus area for analysis
     * @returns Visualization analysis and insights
     */
    async analyzeDataViz(imageSource, userPrompt, analysisFocus) {
        console.info('Starting data visualization analysis', {
            imageSource,
            prompt: userPrompt,
            focus: analysisFocus
        });
        // Validate prompt
        this.validatePrompt(userPrompt, 'data-viz-analysis');
        // Enhance prompt with analysis focus if provided
        let enhancedPrompt = userPrompt;
        if (analysisFocus && analysisFocus.trim()) {
            enhancedPrompt = `${userPrompt}\n\n<analysis_focus>Focus particularly on: ${analysisFocus}.</analysis_focus>`;
        }
        // Process image
        const imageContent = await this.processImageSource(imageSource);
        // Execute analysis
        return await this.executeVisionAnalysis(DATA_VIZ_ANALYSIS_PROMPT, enhancedPrompt, [imageContent], 'data-viz-analysis');
    }
}
/**
 * Register Data Visualization Analysis tool with MCP server
 * @param server MCP server instance
 */
export function registerDataVizAnalysisTool(server) {
    const service = new DataVizAnalysisService();
    const retryableAnalyze = withRetry(service.analyzeDataViz.bind(service), 2, 1000);
    server.tool('analyze_data_visualization', `Analyze data visualizations, charts, graphs, and dashboards to extract insights and trends.

Use this tool ONLY when the user has a data visualization image and wants to understand the data patterns or metrics.
This tool specializes in interpreting visual data representations.

Do NOT use for: UI mockups, error messages, or technical architecture diagrams.`, {
        image_source: z.string().describe('Local file path or remote URL to the image'),
        prompt: z.string().describe('What insights or information you want to extract from this visualization.'),
        analysis_focus: z.string().optional().describe('Optional: specify what to focus on (e.g., \'trends\', \'anomalies\', \'comparisons\', \'performance metrics\'). Leave empty for comprehensive analysis.')
    }, async (params) => {
        try {
            const validationSchema = new ToolSchemaBuilder()
                .required('image_source', CommonSchemas.nonEmptyString)
                .required('prompt', CommonSchemas.nonEmptyString)
                .optional('analysis_focus', z.string())
                .build();
            validationSchema.parse(params);
            const result = await retryableAnalyze(params.image_source, params.prompt, params.analysis_focus);
            return formatMcpResponse(createSuccessResponse(result));
        }
        catch (error) {
            console.error('Data visualization analysis tool execution failed', {
                error: error instanceof Error ? error.message : String(error),
                params
            });
            let errorResponse;
            if (error instanceof z.ZodError) {
                const validationErrors = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
                errorResponse = createErrorResponse(`Validation failed: ${validationErrors}`);
            }
            else if (error instanceof FileNotFoundError) {
                errorResponse = createErrorResponse(`Image file not found: ${error.message}`);
            }
            else if (error instanceof ApiError) {
                errorResponse = createErrorResponse(`API error: ${error.message}`);
            }
            else {
                errorResponse = createErrorResponse(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
            }
            return formatMcpResponse(errorResponse);
        }
    });
    console.info('Data Visualization Analysis tool registered successfully');
}
