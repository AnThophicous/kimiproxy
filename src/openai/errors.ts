export type ErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'permission_error'
  | 'not_found_error'
  | 'rate_limit_error'
  | 'server_error'
  | 'api_error';

export interface OpenAIErrorBody {
  error: {
    message: string;
    type: ErrorType;
    param: string | null;
    code: string | null;
  };
}

export class ApiError extends Error {
  status: number;
  type: ErrorType;
  param: string | null;
  code: string | null;

  constructor(
    message: string,
    status = 500,
    type: ErrorType = 'server_error',
    param: string | null = null,
    code: string | null = null
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.type = type;
    this.param = param;
    this.code = code;
  }

  toJSON(): OpenAIErrorBody {
    return {
      error: {
        message: this.message,
        type: this.type,
        param: this.param,
        code: this.code,
      },
    };
  }
}

export function invalidRequest(
  message: string,
  param: string | null = null,
  code: string | null = 'invalid_request_error'
): ApiError {
  return new ApiError(message, 400, 'invalid_request_error', param, code);
}

export function notFound(
  message: string,
  param: string | null = null,
  code: string | null = 'not_found'
): ApiError {
  return new ApiError(message, 404, 'not_found_error', param, code);
}

export function authError(message = 'Invalid API key'): ApiError {
  return new ApiError(message, 401, 'authentication_error', null, 'invalid_api_key');
}

export function serverError(message: string, code: string | null = 'server_error'): ApiError {
  return new ApiError(message, 500, 'server_error', null, code);
}

export function toErrorBody(err: unknown): OpenAIErrorBody {
  if (err instanceof ApiError) return err.toJSON();
  const message = err instanceof Error ? err.message : String(err);
  return {
    error: {
      message,
      type: 'server_error',
      param: null,
      code: 'server_error',
    },
  };
}

export function statusFromError(err: unknown): number {
  if (err instanceof ApiError) return err.status;
  return 500;
}
