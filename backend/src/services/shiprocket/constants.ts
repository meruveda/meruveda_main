export const SHIPROCKET_BASE_URL = process.env.SHIPROCKET_BASE_URL || 'https://apiv2.shiprocket.in/v1/external';

export const ENDPOINTS = {
  LOGIN: '/auth/login',
  CREATE_ORDER: '/orders/create/adhoc',
  CHECK_SERVICEABILITY: '/courier/serviceability/',
  GENERATE_AWB: '/courier/assign/awb',
  GENERATE_LABEL: '/courier/generate/label',
  GENERATE_INVOICE: '/orders/print/invoice',
  GENERATE_MANIFEST: '/manifests/generate',
  SCHEDULE_PICKUP: '/courier/generate/pickup',
  TRACK_AWB: '/courier/track/awb/',
  CANCEL_ORDER: '/orders/cancel',
  CANCEL_ORDER_BY_ID: '/orders/cancel'
};
