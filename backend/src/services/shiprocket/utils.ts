import { SHIPROCKET_BASE_URL } from './constants';
import { shiprocketAuth } from './auth.service';

interface RequestOptions extends RequestInit {
  retryOnAuthFail?: boolean;
}

export const shiprocketRequest = async <T>(
  endpoint: string, 
  options: RequestOptions = {}
): Promise<T> => {
  const { retryOnAuthFail = true, ...fetchOptions } = options;
  
  const token = await shiprocketAuth.login();
  
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...fetchOptions.headers,
  };

  const response = await fetch(`${SHIPROCKET_BASE_URL}${endpoint}`, {
    ...fetchOptions,
    headers,
  });

  if (response.status === 401 && retryOnAuthFail) {
    // Token might have expired early or been revoked
    console.warn('Shiprocket API returned 401. Clearing token and retrying...');
    shiprocketAuth.clearToken();
    return shiprocketRequest<T>(endpoint, { ...options, retryOnAuthFail: false });
  }

  if (!response.ok) {
    const errorText = await response.text();
    let parsedError;
    try {
      parsedError = JSON.parse(errorText);
    } catch (e) {
      parsedError = errorText;
    }
    const err = new Error(`Shiprocket API Error [${response.status}]: ${JSON.stringify(parsedError)}`);
    (err as any).status = response.status;
    (err as any).details = parsedError;
    throw err;
  }

  return response.json() as Promise<T>;
};
