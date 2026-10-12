const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: 'd:/projects/MeruVeda/backend/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function check() {
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('id', '5ff72802-a5f3-4529-b164-2b7207291b4f')
    .single();

  if (orderErr) {
    console.error("Error order:", orderErr);
    // Let's get the latest order instead if that one is not found
    const { data: latestOrders } = await supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }).limit(1);
    console.log("Latest order:", latestOrders);
  } else {
    console.log("Order found:", order);
  }
}
check();
