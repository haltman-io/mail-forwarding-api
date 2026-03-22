import { HttpException } from "@nestjs/common";

export class PublicHttpException extends HttpException {
  constructor(statusCode: number, body: Record<string, unknown>) {
    super(body, statusCode);
  }
}
