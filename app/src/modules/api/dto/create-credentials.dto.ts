import { IsString, MinLength, IsOptional, IsInt, Min, Max } from "class-validator";
import { Type } from "class-transformer";

export class CreateCredentialsDto {
  @IsString()
  @MinLength(1)
  email!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;
}
