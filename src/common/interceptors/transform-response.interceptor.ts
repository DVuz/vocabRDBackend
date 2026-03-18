import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';

export interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  statusCode: HttpStatus;
  message: string;
  data: T;
  pagination?: PaginationMeta;
}

@Injectable()
export class TransformResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T>
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    const httpResponse = context.switchToHttp().getResponse();
    const customMessage = this.reflector.getAllAndOverride<string>(
      RESPONSE_MESSAGE_KEY,
      [context.getHandler(), context.getClass()],
    );

    return next.handle().pipe(
      map((data) => {
        const statusCode: HttpStatus = httpResponse.statusCode;
        const message = customMessage ?? data?.message ?? 'Success';
        const pagination: PaginationMeta | undefined = data?.pagination;
        const responseData = data?.data !== undefined ? data.data : data;

        const response: ApiResponse<T> = {
          success: true,
          statusCode,
          message,
          data: responseData,
        };

        if (pagination) {
          response.pagination = pagination;
        }

        return response;
      }),
    );
  }
}
