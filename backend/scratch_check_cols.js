const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config({ path: 'c:/projects/MeruVeda/backend/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function check() {
  const { data, error } = await supabase.from('orders').select('*').limit(1);
  if (error) console.error("Error:", error);
  else console.log("Data columns:", data.length ? Object.keys(data[0]) : "No data, can't infer columns easily.");
  
  // Let's try to query another way to get columns or trigger an error to see if it lists columns
  // or just run a direct postgres query if we had pg, but we don't have connection string.
}
check();
