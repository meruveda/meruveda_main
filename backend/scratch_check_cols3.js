const dotenv = require('dotenv');
dotenv.config({ path: 'c:/projects/MeruVeda/backend/.env' });

async function getSpec() {
  const url = `${process.env.SUPABASE_URL}/rest/v1/?apikey=${process.env.SUPABASE_SERVICE_KEY}`;
  const response = await fetch(url);
  const data = await response.json();
  const coupons = data.definitions.coupons.properties;
  console.log("Coupons columns:", Object.keys(coupons));
}
getSpec();
