import { Request, Response, NextFunction, RequestHandler } from "express";

export const asyncHandler = <T extends RequestHandler>(
  requestHandler: T,
): T => {
  return ((request: Request, response: Response, next: NextFunction) => {
    Promise.resolve(requestHandler(request, response, next)).catch((err) =>
      next(err),
    );
  }) as T;
};
