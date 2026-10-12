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
  const options: jwt.SignOptions = { expiresIn: config.jwtExpiresIn as any };
  return jwt.sign(payload, config.jwtSecret, options);
};

export const verifyToken = (token: string): TokenPayload => {
  return jwt.verify(token, config.jwtSecret) as TokenPayload;
};
