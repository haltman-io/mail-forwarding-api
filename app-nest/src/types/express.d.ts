declare namespace Express {
  interface Request {
    id?: string;
    api_token?: {
      id: number;
      owner_email: string;
    };
  }
}
