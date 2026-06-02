export class UserFacingError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: Record<string, unknown>

  constructor(
    message: string,
    options: {
      code?: string
      status?: number
      details?: Record<string, unknown>
    } = {}
  ) {
    super(message)
    this.name = "UserFacingError"
    this.code = options.code ?? "BAD_REQUEST"
    this.status = options.status ?? 400
    this.details = options.details
  }
}

export function errorToObject(error: unknown) {
  if (error instanceof UserFacingError) {
    return {
      ok: false,
      error: error.message,
      code: error.code,
      ...(error.details ? { details: error.details } : {}),
    }
  }
  if (error instanceof Error) {
    return {
      ok: false,
      error: error.message,
      code: "INTERNAL_ERROR",
    }
  }
  return {
    ok: false,
    error: String(error),
    code: "INTERNAL_ERROR",
  }
}
