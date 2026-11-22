import type { IAuthUser } from "./common";

declare global {
  namespace Express {
    // Interface merging is the only way to extend Express's Request type.
    interface Request {
      user?: IAuthUser;
    }
  }
}

export {};
