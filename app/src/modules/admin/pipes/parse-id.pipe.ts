import { Injectable, type PipeTransform } from "@nestjs/common";

import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";

@Injectable()
export class ParseIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "id" });
    }
    return parsed;
  }
}
