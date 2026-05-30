import { z } from 'zod';
import { FileNotFoundError, ApiError } from '../types/index.js';
import { CommonSchemas, ToolSchemaBuilder } from '../utils/validation.js';
import { formatMcpResponse, createSuccessResponse, createErrorResponse, withRetry } from '../core/api-common.js';
import { BaseImageAnalysisService } from '../core/base-image-service.js';
import { GENERAL_IMAGE_ANALYSIS_PROMPT } from '../prompts/index.js';
/**
 * General Image Analysis service - Fallback for any image analysis
 */
class GeneralImageAnalysisService extends BaseImageAnalysisService {
    /**
     * Analyze image with general purpose prompt
     * @param imageSource Image file path or URL
     * @param userPrompt User's analysis request
     * @returns Analysis result
     */
    async analyzeImage(imageSource, userPrompt) {
        console.info('Starting general image analysis', {
            imageSource,
            prompt: userPrompt
        });
        // Validate prompt
        this.validatePrompt(userPrompt, 'analyze-image');
        // Process image
        const imageContent = await this.processImageSource(imageSource);
        // Execute analysis
        return await this.executeVisionAnalysis(GENERAL_IMAGE_ANALYSIS_PROMPT, userPrompt, [imageContent], 'analyze-image');
    }
}
/**
 * Register General Image Analysis tool with MCP server
 * @param server MCP server instance
 */
export function registerGeneralImageAnalysisTool(server) {
    const service = new GeneralImageAnalysisService();
    const retryableAnalyze = withRetry(service.analyzeImage.bind(service), 2, 1000);
    server.tool('analyze_image', `General-purpose image analysis for scenarios not covered by specialized tools.

Use this tool as a FALLBACK when none of the other specialized tools (ui_to_artifact, extract_text_from_screenshot,
diagnose_error_screenshot, understand_technical_diagram, analyze_data_visualization, ui_diff_check) fit the user's need.

This tool provides flexible image understanding for any visual content.`, {
        image_source: z.string().describe('Local file path or remote URL to the image'),
        prompt: z.string().describe('Detailed description of what you want to analyze, extract, or understand from the image. Be specific about your requirements.')
    }, async (params) => {
        try {
            const validationSchema = new ToolSchemaBuilder()
                .required('image_source', CommonSchemas.nonEmptyString)
                .required('prompt', CommonSchemas.nonEmptyString)
                .build();
            validationSchema.parse(params);
            const result = await retryableAnalyze(params.image_source, params.prompt);
            return formatMcpResponse(createSuccessResponse(result));
        }
        catch (error) {
            console.error('General image analysis tool execution failed', {
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
    console.info('General Image Analysis tool registered successfully');
}
