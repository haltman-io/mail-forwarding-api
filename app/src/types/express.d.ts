import type { ResolvedAuthContext } from "../modules/auth/services/auth-session-context.service.js";

export {};

declare global {
  namespace Express {
    interface Request {
      id?: string;
      api_token?: {
        id: number;
        owner_email: string;
      };
      admin_auth?: ResolvedAuthContext;
    }
  }
}
