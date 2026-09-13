import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

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
