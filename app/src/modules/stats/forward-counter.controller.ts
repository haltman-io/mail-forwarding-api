import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { ForwardCounterRepository } from "./forward-counter.repository.js";

@Controller("api/counter")
export class ForwardCounterController {
  private readonly secretKey: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly forwardCounterRepository: ForwardCounterRepository,
  ) {
    this.secretKey = this.configService.getOrThrow<string>("counter.secretKey");
  }

  @Get("increment")
  @HttpCode(HttpStatus.OK)
  async increment(@Query("key") key?: string): Promise<{ success: true }> {
    if (!key || key !== this.secretKey) {
      throw new UnauthorizedException();
    }

    await this.forwardCounterRepository.increment();

    return { success: true };
  }
}
