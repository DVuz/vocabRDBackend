import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: 'Internal server error' };

    // NestJS có thể trả về string hoặc object trong getResponse()
    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : ((exceptionResponse as any).message ?? 'An error occurred');

    const error =
      typeof exceptionResponse === 'object'
        ? ((exceptionResponse as any).error ?? HttpStatus[statusCode])
        : HttpStatus[statusCode];

    if (!(exception instanceof HttpException)) {
      const err = exception as Error;
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}: ${err?.message ?? 'Unknown error'}`,
        err?.stack,
      );
    }

    const finalMessage =
      process.env.NODE_ENV !== 'production' && !(exception instanceof HttpException)
        ? ((exception as Error)?.message ?? 'Internal server error')
        : Array.isArray(message)
          ? message.join(', ')
          : message;

    response.status(statusCode).json({
      success: false,
      statusCode,
      message: finalMessage,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
