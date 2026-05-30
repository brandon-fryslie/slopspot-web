import { z } from 'zod';
import { FileNotFoundError, ApiError } from '../types/index.js';
import { CommonSchemas, ToolSchemaBuilder } from '../utils/validation.js';
import { formatMcpResponse, createSuccessResponse, createErrorResponse, withRetry } from '../core/api-common.js';
import { BaseImageAnalysisService } from '../core/base-image-service.js';
import { TEXT_EXTRACTION_PROMPT } from '../prompts/index.js';
/**
 * Text Extraction service - OCR and text extraction from screenshots
 */
class TextExtractionService extends BaseImageAnalysisService {
    /**
     * Extract text from screenshot
     * @param imageSource Image file path or URL
     * @param userPrompt User's extraction requirements
     * @param programmingLanguage Optional programming language hint
     * @returns Extracted text
     */
    async extractText(imageSource, userPrompt, programmingLanguage) {
        console.info('Starting text extraction', {
            imageSource,
            prompt: userPrompt,
            language: programmingLanguage
        });
        // Validate prompt
        this.validatePrompt(userPrompt, 'text-extraction');
        // Enhance prompt with language hint if provided
        let enhancedPrompt = userPrompt;
        if (programmingLanguage && programmingLanguage.trim()) {
            enhancedPrompt = `${userPrompt}\n\n<language_hint>The code is in ${programmingLanguage}.</language_hint>`;
        }
        // Process image
        const imageContent = await this.processImageSource(imageSource);
        // Execute analysis
        return await this.executeVisionAnalysis(TEXT_EXTRACTION_PROMPT, enhancedPrompt, [imageContent], 'text-extraction');
    }
}
/**
 * Register Text Extraction tool with MCP server
 * @param server MCP server instance
 */
export function registerTextExtractionTool(server) {
    const service = new TextExtractionService();
    const retryableExtract = withRetry(service.extractText.bind(service), 2, 1000);
    server.tool('extract_text_from_screenshot', `Extract and recognize text from screenshots using advanced OCR capabilities.

Use this tool ONLY when the user has a screenshot containing text and wants to extract it.
This tool specializes in OCR for code, terminal output, documentation, and general text extraction.

Do NOT use for: UI design conversion, error diagnosis, or diagram understanding.`, {
        image_source: z.string().describe('Local file path or remote URL to the image'),
        prompt: z.string().describe('Instructions for text extraction. Specify what type of text to extract and any formatting requirements.'),
        programming_language: z.string().optional().describe('Optional: specify the programming language if the screenshot contains code (e.g., \'python\', \'javascript\', \'java\'). Leave empty for auto-detection or non-code text.')
    }, async (params) => {
        try {
            const validationSchema = new ToolSchemaBuilder()
                .required('image_source', CommonSchemas.nonEmptyString)
                .required('prompt', CommonSchemas.nonEmptyString)
                .optional('programming_language', z.string())
                .build();
            validationSchema.parse(params);
            const result = await retryableExtract(params.image_source, params.prompt, params.programming_language);
            return formatMcpResponse(createSuccessResponse(result));
        }
        catch (error) {
            console.error('Text extraction tool execution failed', {
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
    console.info('Text Extraction tool registered successfully');
}
