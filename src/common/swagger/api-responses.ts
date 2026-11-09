import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiProperty, ApiPropertyOptional, ApiResponse, getSchemaPath } from '@nestjs/swagger';

/** Error body produced by AllExceptionsFilter. */
export class ErrorResponseDto {
  @ApiProperty({ example: false })
  success: boolean;

  @ApiProperty({ example: 'Invalid code. Attempts left: 4' })
  message: string;

  @ApiProperty({ example: 'Bad Request' })
  error: string;

  @ApiPropertyOptional({ type: [String], description: 'Validation messages (HTTP 400 validation errors only)' })
  details?: string[];

  @ApiPropertyOptional({ example: 42, description: 'Seconds until a retry is allowed (registration code cooldown, HTTP 429)' })
  retryAfter?: number;
}

export class PaginationMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 57 }) total: number;
  @ApiProperty({ example: 3 }) totalPages: number;
}

/**
 * Documents a success response as wrapped by TransformInterceptor:
 * { success: true, message, data: <model> }. `model: null` documents data: null.
 */
export function ApiEnvelope(
  status: number,
  description: string,
  model: Type<unknown> | null,
  opts: { paginated?: boolean } = {},
) {
  let data: Record<string, unknown>;
  if (!model) {
    data = { type: 'object', nullable: true, example: null };
  } else if (opts.paginated) {
    data = {
      type: 'object',
      properties: {
        items: { type: 'array', items: { $ref: getSchemaPath(model) } },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    };
  } else {
    data = { $ref: getSchemaPath(model) };
  }

  return applyDecorators(
    ApiExtraModels(...(model ? [model] : []), PaginationMetaDto),
    ApiResponse({
      status,
      description,
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Operation successful' },
          data,
        },
      },
    }),
  );
}

/** Documents error responses with the shared ErrorResponseDto body. */
export function ApiErrors(...errors: [status: number, description: string][]) {
  return applyDecorators(
    ...errors.map(([status, description]) => ApiResponse({ status, description, type: ErrorResponseDto })),
  );
}
