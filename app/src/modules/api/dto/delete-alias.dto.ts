import { IsString, MinLength } from "class-validator";

export class DeleteAliasDto {
  @IsString()
  @MinLength(1)
  alias!: string;
}
