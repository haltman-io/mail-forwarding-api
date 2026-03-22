import { Module } from "@nestjs/common";

import { BanPolicyService } from "./ban-policy.service.js";
import { BansRepository } from "./bans.repository.js";

@Module({
  providers: [BansRepository, BanPolicyService],
  exports: [BanPolicyService],
})
export class BansModule {}
