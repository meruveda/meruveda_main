import jwt from 'jsonwebtoken';
import { config } from '../config/env';

export interface TokenPayload {
  id: string;
  role: 'admin' | 'customer';
  email: string;
  /**
   * false = session was created by the no-OTP checkout quick-login and the
   * mobile number has never been proven. Absent (legacy tokens) is treated
   * as verified so existing sessions keep working. OTP verify sets true.
   */
  phone_verified?: boolean;
}

export const generateToken = (payload: TokenPayload): string => {
  // The algorithm is pinned on BOTH sides. Without it, `alg: none` and the
  // RS256/HS256 confusion attack are both open: a token signed with the
  // public key as an HMAC secret would verify against the same secret.
  const options: jwt.SignOptions = { expiresIn: config.jwtExpiresIn as any, algorithm: 'HS256' };
  return jwt.sign(payload, config.jwtSecret, options);
};

export const verifyToken = (token: string): TokenPayload => {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as TokenPayload;
};
