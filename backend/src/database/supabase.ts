import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env';

if (!config.supabaseUrl || !config.supabaseServiceKey) {
  console.warn('⚠️ SUPABASE_URL and SUPABASE_SERVICE_KEY are required for database access. Using mock logic if undefined.');
}

export const supabase = createClient(
  config.supabaseUrl || 'https://mock.supabase.co', 
  config.supabaseServiceKey || 'mock-service-key',
  {
    auth: {
      persistSession: false // We use our own JWT
    }
  }
);
