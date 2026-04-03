import { Transform, Type } from "class-transformer";
import {
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

import { MAX_PASSWORD_LEN, MIN_PASSWORD_LEN } from "../../auth/services/password.service.js";
import { normalizeLowerTrim } from "../../../shared/validation/mailbox.js";

function transformOptionalBooleanInt(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") {
    if (value === 0 || value === 1) return value;
    return Number.NaN;
  }

  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return Number.NaN;
  if (["1", "true", "yes", "on"].includes(normalized)) return 1;
  if (["0", "false", "no", "off"].includes(normalized)) return 0;
  return Number.NaN;
}

function transformOptionalDate(value: unknown): Date | null | undefined | string {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return "__invalid_date__";
  }

  return date;
}

function normalizeOptionalSearch(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return normalizeLowerTrim(value);
}

export class AdminPaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class AdminDomainsListQueryDto extends AdminPaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => transformOptionalBooleanInt(value))
  @IsInt()
  @Min(0)
  @Max(1)
  active?: number;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalSearch(value))
  @IsString()
  @MinLength(1)
  @MaxLength(253)
  name?: string;
}

export class AdminCreateDomainDto {
  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(253)
  name!: string;

  @IsOptional()
  @Transform(({ value }) => transformOptionalBooleanInt(value))
  @IsInt()
  @Min(0)
  @Max(1)
  active?: number;
}

export class AdminUpdateDomainDto {
  @IsOptional()
  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(253)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => transformOptionalBooleanInt(value))
  @IsInt()
  @Min(0)
  @Max(1)
  active?: number;
}

export class AdminAliasesListQueryDto extends AdminPaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => transformOptionalBooleanInt(value))
  @IsInt()
  @Min(0)
  @Max(1)
  active?: number;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalSearch(value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  goto?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalSearch(value))
  @IsString()
  @MinLength(1)
  @MaxLength(253)
  domain?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalSearch(value))
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  handle?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalSearch(value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  address?: string;
}

export class AdminCreateAliasDto {
  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  address!: string;

  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  goto!: string;

  @IsOptional()
  @Transform(({ value }) => transformOptionalBooleanInt(value))
  @IsInt()
  @Min(0)
  @Max(1)
  active?: number;
}

export class AdminUpdateAliasDto {
  @IsOptional()
  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  address?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  goto?: string;

  @IsOptional()
  @Transform(({ value }) => transformOptionalBooleanInt(value))
  @IsInt()
  @Min(0)
  @Max(1)
  active?: number;
}

export class AdminHandlesListQueryDto extends AdminPaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => transformOptionalBooleanInt(value))
  @IsInt()
  @Min(0)
  @Max(1)
  active?: number;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalSearch(value))
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  handle?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalSearch(value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  address?: string;
}

export class AdminCreateHandleDto {
  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  handle!: string;

  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  address!: string;

  @IsOptional()
  @Transform(({ value }) => transformOptionalBooleanInt(value))
  @IsInt()
  @Min(0)
  @Max(1)
  active?: number;
}

export class AdminUpdateHandleDto {
  @IsOptional()
  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  handle?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  address?: string;

  @IsOptional()
  @Transform(({ value }) => transformOptionalBooleanInt(value))
  @IsInt()
  @Min(0)
  @Max(1)
  active?: number;
}

export class AdminBansListQueryDto extends AdminPaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => transformOptionalBooleanInt(value))
  @IsInt()
  @Min(0)
  @Max(1)
  active?: number;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalSearch(value))
  @IsString()
  @Matches(/^(email|domain|ip|name)$/)
  ban_type?: string;

  @IsOptional()
  @Transform(({ value }) => String(value ?? "").trim())
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  ban_value?: string;
}

export class AdminCreateBanDto {
  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @Matches(/^(email|domain|ip|name)$/)
  ban_type!: string;

  @Transform(({ value }) => String(value ?? "").trim())
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  ban_value!: string;

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === null || value === "" ? null : String(value).trim(),
  )
  @IsString()
  @MaxLength(255)
  reason?: string | null;

  @IsOptional()
  @Transform(({ value }) => transformOptionalDate(value))
  @IsDate()
  expires_at?: Date | null;
}

export class AdminUpdateBanDto {
  @IsOptional()
  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @Matches(/^(email|domain|ip|name)$/)
  ban_type?: string;

  @IsOptional()
  @Transform(({ value }) => String(value ?? "").trim())
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  ban_value?: string;

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === null || value === "" ? null : String(value).trim(),
  )
  @IsString()
  @MaxLength(255)
  reason?: string | null;

  @IsOptional()
  @Transform(({ value }) => transformOptionalDate(value))
  @IsDate()
  expires_at?: Date | null;

  @IsOptional()
  @Transform(({ value }) => transformOptionalBooleanInt(value))
  @IsInt()
  @Min(0)
  @Max(1)
  revoked?: number;

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === null || value === "" ? null : String(value).trim(),
  )
  @IsString()
  @MaxLength(255)
  revoked_reason?: string | null;
}

export class AdminApiTokensListQueryDto extends AdminPaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => transformOptionalBooleanInt(value))
  @IsInt()
  @Min(0)
  @Max(1)
  active?: number;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalSearch(value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  owner_email?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalSearch(value))
  @IsString()
  @Matches(/^(active|revoked|expired)$/)
  status?: string;
}

export class AdminCreateApiTokenDto {
  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  owner_email!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;

  @IsOptional()
  @Transform(({ value }) => String(value ?? "").trim())
  @IsString()
  @MaxLength(255)
  user_agent?: string;
}

export class AdminUpdateApiTokenDto {
  @IsOptional()
  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  owner_email?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @Matches(/^(active|revoked|expired)$/)
  status?: string;

  @IsOptional()
  @Transform(({ value }) => transformOptionalDate(value))
  @IsDate()
  expires_at?: Date | null;

  @IsOptional()
  @Transform(({ value }) => transformOptionalBooleanInt(value))
  @IsInt()
  @Min(0)
  @Max(1)
  revoked?: number;

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === null || value === "" ? null : String(value).trim(),
  )
  @IsString()
  @MaxLength(255)
  revoked_reason?: string | null;
}

export class AdminUsersListQueryDto extends AdminPaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => transformOptionalBooleanInt(value))
  @IsInt()
  @Min(0)
  @Max(1)
  active?: number;

  @IsOptional()
  @Transform(({ value }) => transformOptionalBooleanInt(value))
  @IsInt()
  @Min(0)
  @Max(1)
  is_admin?: number;

  @IsOptional()
  @Transform(({ value }) => normalizeOptionalSearch(value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  email?: string;
}

export class AdminCreateUserDto {
  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username!: string;

  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LEN)
  @MaxLength(MAX_PASSWORD_LEN)
  password!: string;

  @IsOptional()
  @Transform(({ value }) => transformOptionalBooleanInt(value))
  @IsInt()
  @Min(0)
  @Max(1)
  is_active?: number;

  @IsOptional()
  @Transform(({ value }) => transformOptionalBooleanInt(value))
  @IsInt()
  @Min(0)
  @Max(1)
  is_admin?: number;
}

export class AdminUpdateUserDto {
  @IsOptional()
  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(MIN_PASSWORD_LEN)
  @MaxLength(MAX_PASSWORD_LEN)
  password?: string;

  @IsOptional()
  @Transform(({ value }) => transformOptionalBooleanInt(value))
  @IsInt()
  @Min(0)
  @Max(1)
  is_active?: number;

  @IsOptional()
  @Transform(({ value }) => transformOptionalBooleanInt(value))
  @IsInt()
  @Min(0)
  @Max(1)
  is_admin?: number;
}

export class AdminUpdateOwnPasswordDto {
  @IsString()
  @MinLength(MIN_PASSWORD_LEN)
  @MaxLength(MAX_PASSWORD_LEN)
  current_password!: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LEN)
  @MaxLength(MAX_PASSWORD_LEN)
  new_password!: string;
}

export class AdminDnsRequestsListQueryDto extends AdminPaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => normalizeOptionalSearch(value))
  @IsString()
  @MinLength(1)
  @MaxLength(253)
  target?: string;

  @IsOptional()
  @Transform(({ value }) => String(value ?? "").trim().toUpperCase())
  @IsString()
  @Matches(/^(UI|EMAIL)$/)
  type?: string;

  @IsOptional()
  @Transform(({ value }) => String(value ?? "").trim().toUpperCase())
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  status?: string;
}

export class AdminCreateDnsRequestDto {
  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(253)
  target!: string;

  @Transform(({ value }) => String(value ?? "").trim().toUpperCase())
  @IsString()
  @Matches(/^(UI|EMAIL)$/)
  type!: string;

  @Transform(({ value }) => String(value ?? "").trim().toUpperCase())
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  status!: string;

  @IsOptional()
  @Transform(({ value }) => transformOptionalDate(value))
  @IsDate()
  activated_at?: Date | null;

  @IsOptional()
  @Transform(({ value }) => transformOptionalDate(value))
  @IsDate()
  last_checked_at?: Date | null;

  @IsOptional()
  @Transform(({ value }) => transformOptionalDate(value))
  @IsDate()
  next_check_at?: Date | null;

  @IsOptional()
  last_check_result_json?: unknown;

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === null || value === "" ? null : String(value).trim(),
  )
  @IsString()
  @MaxLength(65535)
  fail_reason?: string | null;

  @Transform(({ value }) => transformOptionalDate(value))
  @IsDate()
  expires_at!: Date;
}

export class AdminUpdateDnsRequestDto {
  @IsOptional()
  @Transform(({ value }) => normalizeLowerTrim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(253)
  target?: string;

  @IsOptional()
  @Transform(({ value }) => String(value ?? "").trim().toUpperCase())
  @IsString()
  @Matches(/^(UI|EMAIL)$/)
  type?: string;

  @IsOptional()
  @Transform(({ value }) => String(value ?? "").trim().toUpperCase())
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  status?: string;

  @IsOptional()
  @Transform(({ value }) => transformOptionalDate(value))
  @IsDate()
  activated_at?: Date | null;

  @IsOptional()
  @Transform(({ value }) => transformOptionalDate(value))
  @IsDate()
  last_checked_at?: Date | null;

  @IsOptional()
  @Transform(({ value }) => transformOptionalDate(value))
  @IsDate()
  next_check_at?: Date | null;

  @IsOptional()
  last_check_result_json?: unknown;

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === null || value === "" ? null : String(value).trim(),
  )
  @IsString()
  @MaxLength(65535)
  fail_reason?: string | null;

  @IsOptional()
  @Transform(({ value }) => transformOptionalDate(value))
  @IsDate()
  expires_at?: Date;
}
