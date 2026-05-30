import { z } from 'zod';
import { FileNotFoundError, ApiError } from '../types/index.js';
import { ToolExecutionError } from '../core/error-handler.js';
import { CommonSchemas, ToolSchemaBuilder } from '../utils/validation.js';
import { createMultiModalMessage, createVideoContent, formatMcpResponse, createSuccessResponse, createErrorResponse, withRetry } from '../core/api-common.js';
import { fileService } from '../core/file-service.js';
import { chatService } from '../core/chat-service.js';
/**
 * Video analysis service class
 */
export class VideoAnalysisService {
    chatService = chatService;
    fileService = fileService;
    MAX_VIDEO_SIZE_MB = 8;
    /**
     * Execute video analysis
     * @param request Video analysis request
     * @returns Analysis result
     */
    async analyzeVideo(request) {
        console.info('Starting video analysis', {
            videoSource: request.videoSource,
            prompt: request.prompt
        });
        try {
            // Validate video source (file or URL) and size
            await this.fileService.validateVideoSource(request.videoSource, this.MAX_VIDEO_SIZE_MB);
            // Validate prompt
            if (!request.prompt || request.prompt.trim().length === 0) {
                throw new ToolExecutionError('Prompt is required for video analysis', 'video-analysis', 'VALIDATION_ERROR', {
                    toolName: 'video-analysis',
                    operation: 'analyzeVideo',
                    metadata: { videoSource: request.videoSource }
                });
            }
            // Handle video source (URL or local file)
            let videoContent;
            if (this.fileService.isUrl(request.videoSource)) {
                // For URLs, pass directly without base64 encoding
                videoContent = createVideoContent(request.videoSource);
            }
            else {
                // For local files, encode to base64
                const videoData = await this.fileService.encodeVideoToBase64(request.videoSource);
                videoContent = createVideoContent(videoData);
            }
            // Create multimodal message
            const messages = createMultiModalMessage([videoContent], request.prompt);
            const result = await this.chatService.visionCompletions(messages);
            console.info('Video analysis completed', {
                videoSource: request.videoSource
            });
            return result;
        }
        catch (error) {
            console.error('Video analysis failed', {
                error: error instanceof Error ? error.message : String(error),
                videoSource: request.videoSource
            });
            if (error instanceof ToolExecutionError) {
                throw error;
            }
            // Wrap unknown errors
            throw new ToolExecutionError(`Video analysis failed: ${error.message}`, 'video-analysis', 'EXECUTION_ERROR', {
                toolName: 'video-analysis',
                operation: 'analyzeVideo',
                metadata: { videoSource: request.videoSource, originalError: error }
            }, error);
        }
    }
}
/**
 * Register video analysis tool with MCP server
 * @param server MCP server instance
 */
export function registerVideoAnalysisTool(server) {
    const analysisService = new VideoAnalysisService();
    const retryableAnalyze = withRetry(analysisService.analyzeVideo.bind(analysisService), 2, // Maximum 2 retries
    1000 // 1 second delay
    );
    server.tool('analyze_video', `Analyze video content using advanced AI vision models.

Use this tool when the user wants to:
- Understand what happens in a video
- Extract key moments or actions from video
- Analyze video content, scenes, or sequences
- Get descriptions of video footage
- Identify objects, people, or activities in video

Supports both local files and remote URL. Maximum file size: 8MB. Supports MP4, MOV, M4V formats.`, {
        video_source: z.string().describe('Local file path or remote URL to the video (supports MP4, MOV, M4V)'),
        prompt: z.string().describe('Detailed text prompt describing what to analyze, extract, or understand from the video')
    }, async (params) => {
        try {
            // Validate parameters
            const validationSchema = new ToolSchemaBuilder()
                .required('video_source', CommonSchemas.nonEmptyString)
                .required('prompt', CommonSchemas.nonEmptyString)
                .build();
            validationSchema.parse(params);
            // Build request object
            const request = {
                videoSource: params.video_source,
                prompt: params.prompt
            };
            // Execute analysis
            const result = await retryableAnalyze(request);
            const response = createSuccessResponse(result);
            return formatMcpResponse(response);
        }
        catch (error) {
            console.error('Tool execution failed', {
                error: error instanceof Error ? error.message : String(error),
                params
            });
            let errorResponse;
            if (error instanceof z.ZodError) {
                const validationErrors = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
                errorResponse = createErrorResponse(`Validation failed: ${validationErrors}`);
            }
            else if (error instanceof FileNotFoundError) {
                errorResponse = createErrorResponse(`Video file not found: ${error.message}`);
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
    console.info('Video analysis tool registered successfully');
}
