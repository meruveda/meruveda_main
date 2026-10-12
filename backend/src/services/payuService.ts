import crypto from 'crypto';
import { config } from '../config/env';

export interface PayUInitiateParams {
  key: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  phone: string;
  surl: string;
  furl: string;
  hash: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
  actionUrl: string;
}

export const payuService = {
  /**
   * Generates the PayU request hash.
   * Formula: sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt)
   */
  generateRequestHash(params: {
    txnid: string;
    amount: string | number;
    productinfo: string;
    firstname: string;
    email: string;
    udf1?: string;
    udf2?: string;
    udf3?: string;
    udf4?: string;
    udf5?: string;
  }): string {
    const key = config.payuMerchantKey;
    const salt = config.payuSalt;
    const amountStr = typeof params.amount === 'number' ? params.amount.toFixed(2) : Number(params.amount).toFixed(2);
    
    const udf1 = params.udf1 || '';
    const udf2 = params.udf2 || '';
    const udf3 = params.udf3 || '';
    const udf4 = params.udf4 || '';
    const udf5 = params.udf5 || '';

    // key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt
    const hashString = `${key}|${params.txnid}|${amountStr}|${params.productinfo}|${params.firstname}|${params.email}|${udf1}|${udf2}|${udf3}|${udf4}|${udf5}||||||${salt}`;
    
    return crypto.createHash('sha512').update(hashString).digest('hex');
  },

  /**
   * Verifies the PayU response hash.
   * Reverse Formula: sha512(salt|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
   * Note: Some PayU documentation includes additional params if additionalCharges exist.
   */
  verifyResponseHash(responseBody: any): boolean {
    const salt = config.payuSalt;
    const key = config.payuMerchantKey;
    
    const {
      status,
      txnid,
      amount,
      productinfo,
      firstname,
      email,
      udf1 = '',
      udf2 = '',
      udf3 = '',
      udf4 = '',
      udf5 = '',
      hash: receivedHash,
      additionalCharges
    } = responseBody;

    if (!receivedHash) return false;

    const amountStr = typeof amount === 'number' ? amount.toFixed(2) : Number(amount).toFixed(2);

    let hashSequence = `${salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amountStr}|${txnid}|${key}`;
    
    if (additionalCharges) {
      hashSequence = `${additionalCharges}|${hashSequence}`;
    }

    const calculatedHash = crypto.createHash('sha512').update(hashSequence).digest('hex');

    return calculatedHash.toLowerCase() === String(receivedHash).toLowerCase();
  },

  buildCheckoutParams(payload: {
    orderNumber: string;
    amount: number;
    productInfo: string;
    firstName: string;
    email: string;
    phone: string;
    backendUrl: string;
  }): PayUInitiateParams {
    const key = config.payuMerchantKey;
    if (!key) {
      throw new Error('PAYU_MERCHANT_KEY is not configured in environment variables');
    }
    const txnid = payload.orderNumber;
    const amountStr = payload.amount.toFixed(2);
    const productinfo = payload.productInfo || 'MeruVeda Order';
    const firstname = payload.firstName || 'Customer';
    const email = payload.email || 'customer@meruveda.com';
    const phone = payload.phone || '9999999999';

    const surl = `${payload.backendUrl}/api/payu/callback`;
    const furl = `${payload.backendUrl}/api/payu/callback`;

    // Never hand PayU (or the browser) an http:// URL in production — it
    // triggers "information you're about to submit is not secure" warnings.
    // Localhost development is intentionally left untouched.
    const secure = (url: string) => {
      if (process.env.NODE_ENV === 'production' && url.startsWith('http://')) {
        const host = url.slice('http://'.length).split('/')[0];
        if (!host.startsWith('localhost') && host !== '127.0.0.1') {
          return `https://${url.slice('http://'.length)}`;
        }
      }
      return url;
    };

    const hash = this.generateRequestHash({
      txnid,
      amount: amountStr,
      productinfo,
      firstname,
      email
    });

    return {
      key,
      txnid,
      amount: amountStr,
      productinfo,
      firstname,
      email,
      phone,
      surl: secure(surl),
      furl: secure(furl),
      hash,
      actionUrl: secure(config.payuBaseUrl)
    };
  }
};
