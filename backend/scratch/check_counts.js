const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function check() {
  console.log("Checking DB counts...");
  
  const tables = [
    'users',
    'orders',
    'order_items',
    'transactions',
    'reviews',
    'cart_items',
    'wishlist_items',
    'notifications',
    'activity_logs',
    'support_tickets'
  ];

  for (const table of tables) {
    if (table === 'users') {
      const { count: totalUsers, error: err1 } = await supabase.from('users').select('*', { count: 'exact', head: true });
      const { count: customers, error: err2 } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'customer');
      const { count: admins, error: err3 } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'admin');
      
      console.log(`Table: users -> Total: ${totalUsers}, Customers: ${customers}, Admins: ${admins}`);
      if (err1 || err2 || err3) console.error("Error checking users:", err1 || err2 || err3);
    } else {
      const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
      console.log(`Table: ${table} -> Count: ${count}`);
      if (error) console.error(`Error checking ${table}:`, error);
    }
  }
}

check();
