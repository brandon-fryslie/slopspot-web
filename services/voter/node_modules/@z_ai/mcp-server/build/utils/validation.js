import { z } from 'zod';
import { ValidationError } from '../types/index.js';
/**
 * Runtime type validator
 */
export class RuntimeValidator {
    /**
     * Validate data against specified Zod schema
     */
    static validate(data, schema, options = {}) {
        const { throwOnError = true, customMessage, logErrors = true } = options;
        try {
            const result = schema.parse(data);
            return {
                success: true,
                data: result
            };
        }
        catch (error) {
            const validationErrors = this.parseZodError(error);
            if (logErrors) {
                console.warn('Validation failed', {
                    errors: validationErrors,
                    data: this.sanitizeData(data)
                });
            }
            if (throwOnError) {
                const message = customMessage || `Validation failed: ${validationErrors.map(e => e.message).join(', ')}`;
                throw new ValidationError(message, { errors: validationErrors });
            }
            return {
                success: false,
                error: {
                    message: validationErrors.map(e => e.message).join(', '),
                    code: 'VALIDATION_ERROR'
                }
            };
        }
    }
    /**
     * Safe validation, does not throw exceptions
     */
    static safeValidate(data, schema) {
        return this.validate(data, schema, { throwOnError: false });
    }
    /**
     * Parse Zod error to standard validation error format
     */
    static parseZodError(error) {
        return error.issues.map(issue => ({
            message: issue.message,
            field: issue.path.join('.'),
            code: issue.code,
            expected: this.getExpectedType(issue),
            received: 'received' in issue ? String(issue.received) : 'unknown'
        }));
    }
    /**
     * Get expected type description
     */
    static getExpectedType(issue) {
        switch (issue.code) {
            case 'invalid_type':
                return issue.expected;
            case 'too_small':
                return `minimum ${issue.minimum}`;
            case 'too_big':
                return `maximum ${issue.maximum}`;
            default:
                return 'valid value';
        }
    }
    /**
     * Sanitize sensitive data for logging
     */
    static sanitizeData(data) {
        if (typeof data !== 'object' || data === null) {
            return data;
        }
        const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth'];
        const sanitized = { ...data };
        for (const key of Object.keys(sanitized)) {
            if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
                sanitized[key] = '[REDACTED]';
            }
        }
        return sanitized;
    }
}
/**
 * Parameter validation decorator
 */
export function ValidateParams(schema, options = {}) {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = async function (...args) {
            // Assume the first parameter is the parameter object to validate
            const params = args[0];
            try {
                const validationResult = RuntimeValidator.validate(params, schema, options);
                if (!validationResult.success) {
                    throw new ValidationError('Parameter validation failed', { errors: validationResult.errors });
                }
                // Replace original parameters with validated data
                args[0] = validationResult.data;
                return await originalMethod.apply(this, args);
            }
            catch (error) {
                console.error(`Parameter validation failed for ${propertyKey}`, {
                    error: error instanceof Error ? error.message : String(error),
                    params: RuntimeValidator['sanitizeData'](params)
                });
                throw error;
            }
        };
        return descriptor;
    };
}
/**
 * Return value validation decorator
 */
export function ValidateReturn(schema, options = {}) {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = async function (...args) {
            const result = await originalMethod.apply(this, args);
            try {
                const validationResult = RuntimeValidator.validate(result, schema, options);
                if (!validationResult.success) {
                    throw new ValidationError('Return value validation failed', { errors: validationResult.errors });
                }
                return validationResult.data;
            }
            catch (error) {
                console.error(`Return value validation failed for ${propertyKey}`, {
                    error: error instanceof Error ? error.message : String(error),
                    result: RuntimeValidator['sanitizeData'](result)
                });
                throw error;
            }
        };
        return descriptor;
    };
}
/**
 * Common validation schemas
 */
export const CommonSchemas = {
    /** Non-empty string */
    nonEmptyString: z.string().min(1, 'String cannot be empty'),
    /** Positive integer */
    positiveInteger: z.number().int().positive('Must be a positive integer'),
    /** Non-negative integer */
    nonNegativeInteger: z.number().int().min(0, 'Must be a non-negative integer'),
    /** URL format */
    url: z.string().url('Must be a valid URL'),
    /** Email format */
    email: z.string().email('Must be a valid email address'),
    /** UUID format */
    uuid: z.string().uuid('Must be a valid UUID'),
    /** File path */
    filePath: z.string().min(1).refine((path) => !path.includes('..'), 'File path cannot contain ".."'),
    /** Tool name */
    toolName: z.string().regex(/^[a-z][a-z0-9-]*[a-z0-9]$/, 'Tool name must be lowercase, start with letter, and contain only letters, numbers, and hyphens')
};
/**
 * Tool parameter validation schema builder
 */
export class ToolSchemaBuilder {
    schema = {};
    /**
     * Add required field
     */
    required(name, schema) {
        this.schema[name] = schema;
        return this;
    }
    /**
     * Add optional field
     */
    optional(name, schema) {
        this.schema[name] = schema.optional();
        return this;
    }
    /**
     * Add field with default value
     */
    withDefault(name, schema, defaultValue) {
        this.schema[name] = schema.default(() => defaultValue);
        return this;
    }
    /**
     * Build final validation schema
     */
    build() {
        return z.object(this.schema);
    }
}
