const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config({ path: 'c:/projects/MeruVeda/backend/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function check() {
  const { data, error } = await supabase.from('products').select('*').limit(1);
  if (error) console.error("Error:", error);
  else console.log("Products columns:", data.length ? Object.keys(data[0]) : "No products found");
}
check();
