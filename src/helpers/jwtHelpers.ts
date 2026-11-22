import jwt, { type SignOptions } from "jsonwebtoken";
import config from "@/config";
import { unauthorized } from "@/errors/ApiError";

export type TokenPayload = { id: string; role: string; phone_number: string };

const sign = (payload: TokenPayload, secret: string, expiresIn: string) =>
  jwt.sign(payload, secret, { expiresIn: expiresIn as SignOptions["expiresIn"] });

export const issueTokens = (payload: TokenPayload) => ({
  access_token: sign(payload, config.jwt.accessSecret, config.jwt.accessExpiresIn),
  refresh_token: sign(payload, config.jwt.refreshSecret, config.jwt.refreshExpiresIn),
});

const verify = (token: string, secret: string): TokenPayload => {
  try {
    const p = jwt.verify(token, secret) as TokenPayload;
    return { id: p.id, role: p.role, phone_number: p.phone_number };
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
