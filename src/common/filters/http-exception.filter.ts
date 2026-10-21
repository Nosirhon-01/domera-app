import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

const PRISMA_ERRORS: Record<string, { status: number; error: string; message: string }> = {
  P2002: { status: HttpStatus.CONFLICT, error: 'Conflict', message: 'A record with this value already exists' },
  P2025: { status: HttpStatus.NOT_FOUND, error: 'Not Found', message: 'Record not found' },
  P2003: { status: HttpStatus.BAD_REQUEST, error: 'Bad Request', message: 'Related record does not exist' },
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'INTERNAL_SERVER_ERROR';
    let details: any = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse() as any;

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        message = res.message || exception.message;
        error = res.error || HttpStatus[status] || 'ERROR';

        if (Array.isArray(res.message)) {
          message = 'Validation failed';
          details = res.message;
        }
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && PRISMA_ERRORS[exception.code]) {
      // Known DB constraint errors (e.g. duplicate email from a race) are client errors, not 500s
      ({ status, error, message } = PRISMA_ERRORS[exception.code]);
    } else if (exception instanceof Error) {
      this.logger.error(`Unexpected Exception: ${exception.message}`, exception.stack);
      message = process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : exception.message;
    }

    response.status(status).json({
      success: false,
      message,
      error,
      ...(details ? { details } : {}),
    });
  }
}
