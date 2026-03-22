import { Module } from "@nestjs/common";

import { BansModule } from "../bans/bans.module.js";
import { CheckDnsClient } from "./check-dns.client.js";
import { CheckDnsController } from "./check-dns.controller.js";
import { CheckDnsService } from "./check-dns.service.js";

@Module({
  imports: [BansModule],
  controllers: [CheckDnsController],
  providers: [CheckDnsClient, CheckDnsService],
})
export class CheckDnsModule {}
