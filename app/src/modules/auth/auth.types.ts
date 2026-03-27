import type { AccessJwtSettings } from "../../shared/utils/access-jwt.js";
import type { AuthCookieSameSite } from "../../shared/utils/auth-cookies.js";

export interface AppSettings {
  envName: string;
}

export interface AuthSettings extends AccessJwtSettings {
  passwordResetTtlMinutes: number;
  refreshTtlDays: number;
  maxActiveSessionFamilies: number;
  cookieSameSite: AuthCookieSameSite;
  csrfSecret: string;
}

export interface PublicAuthUser {
  id: number;
  username: string;
  email: string;
  email_verified_at: string | null;
  is_active: number;
  is_admin: boolean;
  created_at: string | null;
  updated_at: string | null;
  last_login_at: string | null;
}
