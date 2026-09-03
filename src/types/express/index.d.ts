import { AuthorizedUser } from "../../utils/types";

declare global {
  namespace Express {
    interface Request {
      user?: AuthorizedUser;
    }
  }
}

export {};
