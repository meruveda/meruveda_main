const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: 'c:/projects/MeruVeda/backend/.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function check() {
  const { data, error } = await supabase.rpc('get_columns', {}); // this will fail, but maybe...
  // Let's insert a dummy row with a fake column
  const { error: err2 } = await supabase.from('coupons').insert({ fake_column: 1 });
  console.log("Insert error:", err2);
}
check();
