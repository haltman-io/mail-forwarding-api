import { IsString, MinLength, MaxLength } from "class-validator";

export class SignInDto {
  @IsString()
  @MinLength(1)
  identifier!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
