import { IsString, MinLength, MaxLength } from "class-validator";

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  new_password!: string;
}
