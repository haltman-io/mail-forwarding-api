import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export const MAX_PGP_PUBLIC_KEY_LENGTH = 16 * 1024;

function primitiveToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

function transformOptionalBoolean(value: unknown): boolean | undefined | string {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;

  const normalized = primitiveToString(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return "__invalid_boolean__";
}

export class PgpKeyCreateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_PGP_PUBLIC_KEY_LENGTH)
  public_key!: string;

  @IsOptional()
  @Transform(({ value }) => transformOptionalBoolean(value))
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Transform(({ value }) => transformOptionalBoolean(value))
  @IsBoolean()
  hide_subject?: boolean;
}

export class PgpKeyPatchDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_PGP_PUBLIC_KEY_LENGTH)
  public_key?: string;

  @IsOptional()
  @Transform(({ value }) => transformOptionalBoolean(value))
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Transform(({ value }) => transformOptionalBoolean(value))
  @IsBoolean()
  hide_subject?: boolean;
}
