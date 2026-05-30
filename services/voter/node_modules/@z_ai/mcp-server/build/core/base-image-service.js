import { ToolExecutionError } from './error-handler.js';
import { createMultiModalMessage, createImageContent } from './api-common.js';
import { fileService } from './file-service.js';
import { chatService } from './chat-service.js';
/**
 * Base image analysis service providing shared functionality
 * for all specialized image analysis tools
 */
export class BaseImageAnalysisService {
    chatService = chatService;
    fileService = fileService;
    MAX_IMAGE_SIZE_MB = 5;
    /**
     * Process image source and validate it
     * @param imageSource Image file path or URL
     * @returns Processed image content for API
     */
    async processImageSource(imageSource) {
        // Validate image source and size
        await this.fileService.validateImageSource(imageSource, this.MAX_IMAGE_SIZE_MB);
        // Handle image source (URL or local file)
        if (this.fileService.isUrl(imageSource)) {
            // For URLs, pass directly without base64 encoding
            return createImageContent(imageSource);
        }
        else {
            // For local files, encode to base64
            const imageData = await this.fileService.encodeImageToBase64(imageSource);
            return createImageContent(imageData);
        }
    }
    /**
     * Process multiple image sources (for tools like UI diff)
     * @param imageSources Array of image file paths or URLs
     * @returns Array of processed image content objects
     */
    async processMultipleImageSources(imageSources) {
        const imageContents = [];
        for (const imageSource of imageSources) {
            const imageContent = await this.processImageSource(imageSource);
            imageContents.push(imageContent);
        }
        return imageContents;
    }
    /**
     * Execute vision analysis with a system prompt
     * @param systemPrompt System-level instructions for the AI
     * @param userPrompt User's specific request
     * @param imageContents Array of processed image content
     * @param toolName Name of the calling tool (for error context)
     * @returns Analysis result
     */
    async executeVisionAnalysis(systemPrompt, userPrompt, imageContents, toolName) {
        try {
            // Create multimodal message with system context
            const messages = [
                {
                    role: 'system',
                    content: systemPrompt
                },
                ...createMultiModalMessage(imageContents, userPrompt)
            ];
            const result = await this.chatService.visionCompletions(messages);
            console.info(`${toolName} analysis completed successfully`);
            return result;
        }
        catch (error) {
            console.error(`${toolName} analysis failed`, {
                error: error instanceof Error ? error.message : String(error)
            });
            throw new ToolExecutionError(`${toolName} analysis failed: ${error.message}`, toolName, 'EXECUTION_ERROR', {
                toolName,
                operation: 'executeVisionAnalysis',
                metadata: { originalError: error }
            }, error);
        }
    }
    /**
     * Validate that a prompt is not empty
     * @param prompt Prompt to validate
     * @param toolName Name of the calling tool
     */
    validatePrompt(prompt, toolName) {
        if (!prompt || prompt.trim().length === 0) {
            throw new ToolExecutionError('Prompt is required for image analysis', toolName, 'VALIDATION_ERROR', {
                toolName,
                operation: 'validatePrompt'
            });
        }
    }
}
