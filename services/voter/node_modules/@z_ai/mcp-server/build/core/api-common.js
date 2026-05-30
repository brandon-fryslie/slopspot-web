/**
 * Create multimodal message content
 * @param content Content array including images, text, etc.
 * @param prompt Text prompt
 * @returns Formatted message array
 */
export function createMultiModalMessage(content, prompt) {
    return [{
            role: 'user',
            content: [...content, { type: 'text', text: prompt }]
        }];
}
/**
 * Create text message
 * @param prompt Text content
 * @returns Formatted message array
 */
export function createTextMessage(prompt) {
    return [{
            role: 'user',
            content: [{ type: 'text', text: prompt }]
        }];
}
/**
 * Create image message content
 * @param imageUrl Image URL or base64 data
 * @returns Image content object
 */
export function createImageContent(imageUrl) {
    return {
        type: 'image_url',
        image_url: { url: imageUrl }
    };
}
/**
 * Create video message content
 * @param videoUrl Video URL or base64 data
 * @returns Video content object
 */
export function createVideoContent(videoUrl) {
    return {
        type: 'video_url', // Most AI models treat video as image_url type
        video_url: { url: videoUrl }
    };
}
/**
 * Create error response
 * @param message Error message
 * @param error Optional error object
 * @returns Standardized error response
 */
export function createErrorResponse(message, error) {
    return {
        success: false,
        error: message,
        timestamp: Date.now(),
        ...(error && { context: { stack: error.stack, name: error.name } })
    };
}
/**
 * Create success response
 * @param data Response data
 * @returns Standardized success response
 */
export function createSuccessResponse(data) {
    return {
        success: true,
        data,
        timestamp: Date.now()
    };
}
/**
 * Format response content to MCP format
 * @param response API response
 * @returns MCP tool response format
 */
export function formatMcpResponse(response) {
    if (response.success) {
        const text = typeof response.data === 'string'
            ? response.data
            : JSON.stringify(response.data, null, 2);
        return {
            content: [{ type: 'text', text }]
        };
    }
    else {
        return {
            content: [{
                    type: 'text',
                    text: `Error: ${response.error}`
                }],
            isError: true
        };
    }
}
/**
 * Create async function with retry mechanism
 * @param fn Async function to execute
 * @param maxRetries Maximum retry attempts
 * @param delay Retry delay in milliseconds
 * @returns Wrapped function
 */
export function withRetry(fn, maxRetries = 3, delay = 1000) {
    return async (...args) => {
        let lastError;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn(...args);
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                if (attempt === maxRetries) {
                    throw lastError;
                }
                // Exponential backoff
                const waitTime = delay * Math.pow(2, attempt);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
        throw lastError;
    };
}
