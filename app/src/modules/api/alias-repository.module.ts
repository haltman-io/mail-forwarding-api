import { Module } from "@nestjs/common";

import { AliasRepository } from "./repositories/alias.repository.js";

@Module({
  providers: [AliasRepository],
  exports: [AliasRepository],
})
export class AliasRepositoryModule {}
