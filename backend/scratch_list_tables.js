const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config({ path: 'd:/projects/MeruVeda/backend/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function check() {
  // Querying a common table or system catalog via rest might not be allowed, but let's try to query public tables
  // We can try to query different table names or check postgrest schema
  const { data, error } = await supabase.from('pg_tables').select('*'); // unlikely to work, but let's see
  console.log("pg_tables:", data, "Error:", error);
}
check();
