import jwt, { type SignOptions } from "jsonwebtoken";
import config from "@/config";
import { unauthorized } from "@/errors/ApiError";

/**
 * Access + refresh tokens. Each token carries the user's `token_version` (as `tv`).
 * Logout or a password change raises the version in the database, so every token
 * issued before that stops working — on every device.
 */
export type TokenPayload = { id: string; role: string; phone_number: string; tv: number };

/** The user fields a token is made from. */
type TokenUser = { id: string; role: string; phone_number: string; token_version: number };

const sign = (payload: TokenPayload, secret: string, expiresIn: string) =>
  jwt.sign(payload, secret, { expiresIn: expiresIn as SignOptions["expiresIn"] });

export const issueTokens = (user: TokenUser) => {
  const payload: TokenPayload = {
    id: user.id,
    role: user.role,
    phone_number: user.phone_number,
    tv: user.token_version,
  };
  return {
    access_token: sign(payload, config.jwt.accessSecret, config.jwt.accessExpiresIn),
    refresh_token: sign(payload, config.jwt.refreshSecret, config.jwt.refreshExpiresIn),
  };
};

const verify = (token: string, secret: string): TokenPayload => {
  try {
    const p = jwt.verify(token, secret) as Partial<TokenPayload>;
    // Tokens made before token_version existed count as version 0.
    return { id: p.id!, role: p.role!, phone_number: p.phone_number!, tv: p.tv ?? 0 };
  } catch (err) {
    throw unauthorized(
      (err as Error).name === "TokenExpiredError"
        ? "Your session has expired. Please log in again."
        : "Invalid token. Please log in again."
    );
  }
};

export const verifyAccessToken = (token: string) => verify(token, config.jwt.accessSecret);
export const verifyRefreshToken = (token: string) => verify(token, config.jwt.refreshSecret);

/** Throws 401 when the token was issued before the user's last logout / password change. */
export const assertTokenCurrent = (payload: TokenPayload, user: { token_version: number }): void => {
  if (payload.tv !== user.token_version) throw unauthorized("You have been logged out. Please log in again.");
};
