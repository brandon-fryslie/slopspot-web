import { z } from 'zod';
import { FileNotFoundError, ApiError } from '../types/index.js';
import { CommonSchemas, ToolSchemaBuilder } from '../utils/validation.js';
import { formatMcpResponse, createSuccessResponse, createErrorResponse, withRetry } from '../core/api-common.js';
import { BaseImageAnalysisService } from '../core/base-image-service.js';
import { UI_DIFF_CHECK_PROMPT } from '../prompts/index.js';
/**
 * UI Diff Check service - Compare two UI screenshots
 */
class UiDiffCheckService extends BaseImageAnalysisService {
    /**
     * Compare two UI screenshots
     * @param expectedImageSource Expected/reference design image
     * @param actualImageSource Actual implementation image
     * @param userPrompt User's comparison requirements
     * @returns Comparison analysis with differences
     */
    async compareUiScreenshots(expectedImageSource, actualImageSource, userPrompt) {
        console.info('Starting UI diff comparison', {
            expectedImage: expectedImageSource,
            actualImage: actualImageSource,
            prompt: userPrompt
        });
        // Validate prompt
        this.validatePrompt(userPrompt, 'ui-diff-check');
        // Enhance prompt to clarify which image is which
        const enhancedPrompt = `<images>
The first image is the EXPECTED/REFERENCE design (the target).
The second image is the ACTUAL/CURRENT implementation (what needs to be checked).
</images>

${userPrompt}`;
        // Process both images
        const imageContents = await this.processMultipleImageSources([
            expectedImageSource,
            actualImageSource
        ]);
        // Execute analysis
        return await this.executeVisionAnalysis(UI_DIFF_CHECK_PROMPT, enhancedPrompt, imageContents, 'ui-diff-check');
    }
}
/**
 * Register UI Diff Check tool with MCP server
 * @param server MCP server instance
 */
export function registerUiDiffCheckTool(server) {
    const service = new UiDiffCheckService();
    const retryableCompare = withRetry(service.compareUiScreenshots.bind(service), 2, 1000);
    server.tool('ui_diff_check', `Compare two UI screenshots to identify visual differences and implementation discrepancies.

Use this tool ONLY when the user wants to compare an expected/reference UI with an actual implementation.
This tool is specialized for UI quality assurance and design-to-implementation verification.

Do NOT use for: general image comparison, error diagnosis, or analyzing single UIs.`, {
        expected_image_source: z.string().describe('Local file path or remote URL to the image'),
        actual_image_source: z.string().describe('Local file path or remote URL to the image'),
        prompt: z.string().describe('Instructions for the comparison. Specify what aspects to focus on or what level of detail is needed.')
    }, async (params) => {
        try {
            const validationSchema = new ToolSchemaBuilder()
                .required('expected_image_source', CommonSchemas.nonEmptyString)
                .required('actual_image_source', CommonSchemas.nonEmptyString)
                .required('prompt', CommonSchemas.nonEmptyString)
                .build();
            validationSchema.parse(params);
            const result = await retryableCompare(params.expected_image_source, params.actual_image_source, params.prompt);
            return formatMcpResponse(createSuccessResponse(result));
        }
        catch (error) {
            console.error('UI diff check tool execution failed', {
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
    console.info('UI Diff Check tool registered successfully');
}
