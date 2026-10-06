export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: string[],
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const badRequest = (message: string, details?: string[]) => new HttpError(400, message, details);
