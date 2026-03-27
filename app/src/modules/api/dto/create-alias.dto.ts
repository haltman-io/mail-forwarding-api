import { IsString, MinLength } from "class-validator";

export class CreateAliasDto {
  @IsString()
  @MinLength(1)
  alias_handle!: string;

  @IsString()
  @MinLength(1)
  alias_domain!: string;
}
