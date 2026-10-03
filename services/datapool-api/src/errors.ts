export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function notFound(message: string): ApiError {
  return new ApiError(404, 'not_found', message)
}

export function conflict(message: string): ApiError {
  return new ApiError(409, 'conflict', message)
}
