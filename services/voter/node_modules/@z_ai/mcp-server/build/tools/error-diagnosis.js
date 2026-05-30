import { z } from 'zod';
import { FileNotFoundError, ApiError } from '../types/index.js';
import { CommonSchemas, ToolSchemaBuilder } from '../utils/validation.js';
import { formatMcpResponse, createSuccessResponse, createErrorResponse, withRetry } from '../core/api-common.js';
import { BaseImageAnalysisService } from '../core/base-image-service.js';
import { ERROR_DIAGNOSIS_PROMPT } from '../prompts/index.js';
/**
 * Error Diagnosis service - Analyze error messages and stack traces
 */
class ErrorDiagnosisService extends BaseImageAnalysisService {
    /**
     * Diagnose error from screenshot
     * @param imageSource Image file path or URL
     * @param userPrompt User's question about the error
     * @param context Optional context about when error occurred
     * @returns Diagnostic analysis and solution
     */
    async diagnoseError(imageSource, userPrompt, context) {
        console.info('Starting error diagnosis', {
            imageSource,
            prompt: userPrompt,
            context
        });
        // Validate prompt
        this.validatePrompt(userPrompt, 'error-diagnosis');
        // Enhance prompt with context if provided
        let enhancedPrompt = userPrompt;
        if (context && context.trim()) {
            enhancedPrompt = `${userPrompt}\n\n<error_context>This error occurred ${context}.</error_context>`;
        }
        // Process image
        const imageContent = await this.processImageSource(imageSource);
        // Execute analysis
        return await this.executeVisionAnalysis(ERROR_DIAGNOSIS_PROMPT, enhancedPrompt, [imageContent], 'error-diagnosis');
    }
}
/**
 * Register Error Diagnosis tool with MCP server
 * @param server MCP server instance
 */
export function registerErrorDiagnosisTool(server) {
    const service = new ErrorDiagnosisService();
    const retryableDiagnose = withRetry(service.diagnoseError.bind(service), 2, 1000);
    server.tool('diagnose_error_screenshot', `Diagnose and analyze error messages, stack traces, and exception screenshots.

Use this tool ONLY when the user has an error screenshot and needs help understanding or fixing it.
This tool specializes in error analysis and provides actionable solutions.

Do NOT use for: code extraction, UI analysis, or diagram understanding.`, {
        image_source: z.string().describe('Local file path or remote URL to the image'),
        prompt: z.string().describe('Description of what you need help with regarding this error. Include any relevant context about when it occurred.'),
        context: z.string().optional().describe('Optional: additional context about when the error occurred (e.g., \'during npm install\', \'when running the app\', \'after deployment\'). Helps with more accurate diagnosis.')
    }, async (params) => {
        try {
            const validationSchema = new ToolSchemaBuilder()
                .required('image_source', CommonSchemas.nonEmptyString)
                .required('prompt', CommonSchemas.nonEmptyString)
                .optional('context', z.string())
                .build();
            validationSchema.parse(params);
            const result = await retryableDiagnose(params.image_source, params.prompt, params.context);
            return formatMcpResponse(createSuccessResponse(result));
        }
        catch (error) {
            console.error('Error diagnosis tool execution failed', {
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
    console.info('Error Diagnosis tool registered successfully');
}
