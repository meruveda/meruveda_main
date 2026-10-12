const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config({ path: 'd:/projects/MeruVeda/backend/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function check() {
  const { data, error } = await supabase.from('orders').select('*').limit(1);
  if (error) console.error("Error:", error);
  else console.log("Orders columns:", data.length ? Object.keys(data[0]) : "No orders found");
}
check();
