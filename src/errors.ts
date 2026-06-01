export class UserFacingError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, options: { code?: string; status?: number } = {}) {
    super(message)
    this.name = "UserFacingError"
    this.code = options.code ?? "BAD_REQUEST"
    this.status = options.status ?? 400
  }
}

export function errorToObject(error: unknown) {
  if (error instanceof UserFacingError) {
    return {
      ok: false,
      error: error.message,
      code: error.code,
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
