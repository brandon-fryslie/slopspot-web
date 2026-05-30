import { z } from 'zod';
import { FileNotFoundError, ApiError } from '../types/index.js';
import { CommonSchemas, ToolSchemaBuilder } from '../utils/validation.js';
import { formatMcpResponse, createSuccessResponse, createErrorResponse, withRetry } from '../core/api-common.js';
import { BaseImageAnalysisService } from '../core/base-image-service.js';
import { UI_TO_ARTIFACT_PROMPTS } from '../prompts/index.js';
/**
 * UI to Artifact service - Convert UI screenshots to code/prompts/specs/descriptions
 */
class UiToArtifactService extends BaseImageAnalysisService {
    /**
     * Convert UI screenshot to specified artifact type
     * @param imageSource Image file path or URL
     * @param outputType Type of output (code, prompt, spec, description)
     * @param userPrompt User's specific requirements
     * @returns Generated artifact
     */
    async convertUiToArtifact(imageSource, outputType, userPrompt) {
        console.info('Starting UI to artifact conversion', {
            imageSource,
            outputType,
            prompt: userPrompt
        });
        // Validate output type
        const normalizedType = outputType.toLowerCase();
        const systemPrompt = UI_TO_ARTIFACT_PROMPTS[normalizedType];
        if (!systemPrompt) {
            throw new Error(`Invalid output_type '${outputType}'. Must be one of: code, prompt, spec, description`);
        }
        // Validate prompt
        this.validatePrompt(userPrompt, 'ui-to-artifact');
        // Process image
        const imageContent = await this.processImageSource(imageSource);
        // Execute analysis
        return await this.executeVisionAnalysis(systemPrompt, userPrompt, [imageContent], 'ui-to-artifact');
    }
}
/**
 * Register UI to Artifact tool with MCP server
 * @param server MCP server instance
 */
export function registerUiToArtifactTool(server) {
    const service = new UiToArtifactService();
    const retryableConvert = withRetry(service.convertUiToArtifact.bind(service), 2, 1000);
    server.tool('ui_to_artifact', `Convert UI screenshots into various artifacts: code, prompts, design specifications, or descriptions.

Use this tool ONLY when the user wants to:
- Generate frontend code from UI design (output_type='code')
- Create AI prompts for UI generation (output_type='prompt')
- Extract design specifications (output_type='spec')
- Get natural language description of the UI (output_type='description')

Do NOT use for: screenshots containing text/code to extract, error messages, diagrams, or data visualizations.`, {
        image_source: z.string().describe('Local file path or remote URL to the image'),
        output_type: z.enum(['code', 'prompt', 'spec', 'description']).describe("Type of output to generate. Options: 'code' (generate frontend code), 'prompt' (generate AI prompt for recreating this UI), 'spec' (generate design specification document), 'description' (natural language description of the UI)."),
        prompt: z.string().describe('Detailed instructions describing what to generate from this UI image. Should clearly state the desired output and any specific requirements.')
    }, async (params) => {
        try {
            const validationSchema = new ToolSchemaBuilder()
                .required('image_source', CommonSchemas.nonEmptyString)
                .required('output_type', z.enum(['code', 'prompt', 'spec', 'description']))
                .required('prompt', CommonSchemas.nonEmptyString)
                .build();
            validationSchema.parse(params);
            const result = await retryableConvert(params.image_source, params.output_type, params.prompt);
            return formatMcpResponse(createSuccessResponse(result));
        }
        catch (error) {
            console.error('UI to artifact tool execution failed', {
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
    console.info('UI to Artifact tool registered successfully');
}
