import { z } from 'zod';
import { FileNotFoundError, ApiError } from '../types/index.js';
import { CommonSchemas, ToolSchemaBuilder } from '../utils/validation.js';
import { formatMcpResponse, createSuccessResponse, createErrorResponse, withRetry } from '../core/api-common.js';
import { BaseImageAnalysisService } from '../core/base-image-service.js';
import { DIAGRAM_UNDERSTANDING_PROMPT } from '../prompts/index.js';
/**
 * Diagram Analysis service - Analyze technical diagrams
 */
class DiagramAnalysisService extends BaseImageAnalysisService {
    /**
     * Analyze technical diagram
     * @param imageSource Image file path or URL
     * @param userPrompt User's question about the diagram
     * @param diagramType Optional diagram type hint
     * @returns Diagram analysis and explanation
     */
    async analyzeDiagram(imageSource, userPrompt, diagramType) {
        console.info('Starting diagram analysis', {
            imageSource,
            prompt: userPrompt,
            diagramType
        });
        // Validate prompt
        this.validatePrompt(userPrompt, 'diagram-analysis');
        // Enhance prompt with diagram type hint if provided
        let enhancedPrompt = userPrompt;
        if (diagramType && diagramType.trim()) {
            enhancedPrompt = `${userPrompt}\n\n<diagram_type_hint>This is a ${diagramType} diagram.</diagram_type_hint>`;
        }
        // Process image
        const imageContent = await this.processImageSource(imageSource);
        // Execute analysis
        return await this.executeVisionAnalysis(DIAGRAM_UNDERSTANDING_PROMPT, enhancedPrompt, [imageContent], 'diagram-analysis');
    }
}
/**
 * Register Diagram Analysis tool with MCP server
 * @param server MCP server instance
 */
export function registerDiagramAnalysisTool(server) {
    const service = new DiagramAnalysisService();
    const retryableAnalyze = withRetry(service.analyzeDiagram.bind(service), 2, 1000);
    server.tool('understand_technical_diagram', `Analyze and explain technical diagrams including architecture diagrams, flowcharts, UML, ER diagrams, and system design diagrams.

Use this tool ONLY when the user has a technical diagram and wants to understand its structure or components.
This tool specializes in interpreting visual technical documentation.

Do NOT use for: UI screenshots, error messages, or data visualizations/charts.`, {
        image_source: z.string().describe('Local file path or remote URL to the image'),
        prompt: z.string().describe('What you want to understand or extract from this diagram.'),
        diagram_type: z.string().optional().describe('Optional: specify the diagram type if known (e.g., \'architecture\', \'flowchart\', \'uml\', \'er-diagram\', \'sequence\'). Leave empty for auto-detection.')
    }, async (params) => {
        try {
            const validationSchema = new ToolSchemaBuilder()
                .required('image_source', CommonSchemas.nonEmptyString)
                .required('prompt', CommonSchemas.nonEmptyString)
                .optional('diagram_type', z.string())
                .build();
            validationSchema.parse(params);
            const result = await retryableAnalyze(params.image_source, params.prompt, params.diagram_type);
            return formatMcpResponse(createSuccessResponse(result));
        }
        catch (error) {
            console.error('Diagram analysis tool execution failed', {
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
    console.info('Diagram Analysis tool registered successfully');
}
