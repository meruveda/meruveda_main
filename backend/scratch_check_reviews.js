const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config({ path: 'd:/projects/MeruVeda/backend/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function check() {
  const { data, error } = await supabase.from('reviews').select('*, users(first_name, last_name)').limit(10);
  console.log("Reviews:", data, "Error:", error);
}
check();
