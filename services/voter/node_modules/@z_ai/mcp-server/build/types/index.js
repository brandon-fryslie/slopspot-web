// Error types
export class McpError extends Error {
    code;
    context;
    constructor(message, code, context) {
        super(message);
        this.code = code;
        this.context = context;
        this.name = 'McpError';
    }
}
export class ValidationError extends McpError {
    field;
    constructor(message, context, field) {
        super(message, 'VALIDATION_ERROR', context);
        this.field = field;
        this.name = 'ValidationError';
    }
}
export class ApiError extends McpError {
    statusCode;
    details;
    constructor(message, context, statusCode, details) {
        super(message, 'API_ERROR', context);
        this.statusCode = statusCode;
        this.details = details;
        this.name = 'ApiError';
    }
}
export class FileNotFoundError extends McpError {
    constructor(filePath) {
        super(`File not found: ${filePath}`, 'FILE_NOT_FOUND', { filePath });
        this.name = 'FileNotFoundError';
    }
}
