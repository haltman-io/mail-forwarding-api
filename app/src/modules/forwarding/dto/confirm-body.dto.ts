import { IsString, MinLength } from "class-validator";

export class ConfirmBodyDto {
  @IsString()
  @MinLength(1)
  token!: string;
}
