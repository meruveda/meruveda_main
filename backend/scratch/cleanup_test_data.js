const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function cleanData() {
  console.log("Starting database cleanup...");
  
  // 1. Delete transactions
  console.log("Deleting transactions...");
  const { count: txCount, error: txErr } = await supabase.from('transactions').delete({ count: 'exact' }).neq('id', '00000000-0000-0000-0000-000000000000'); // delete all
  if (txErr) console.error("Error deleting transactions:", txErr);
  else console.log(`Deleted ${txCount} transactions.`);

  // 2. Delete order_items
  console.log("Deleting order items...");
  const { count: itemsCount, error: itemsErr } = await supabase.from('order_items').delete({ count: 'exact' }).neq('id', '00000000-0000-0000-0000-000000000000');
  if (itemsErr) console.error("Error deleting order items:", itemsErr);
  else console.log(`Deleted ${itemsCount} order items.`);

  // 3. Delete orders
  console.log("Deleting orders...");
  const { count: ordersCount, error: ordersErr } = await supabase.from('orders').delete({ count: 'exact' }).neq('id', '00000000-0000-0000-0000-000000000000');
  if (ordersErr) console.error("Error deleting orders:", ordersErr);
  else console.log(`Deleted ${ordersCount} orders.`);

  // 4. Delete cart_items
  console.log("Deleting cart items...");
  const { count: cartCount, error: cartErr } = await supabase.from('cart_items').delete({ count: 'exact' }).neq('id', '00000000-0000-0000-0000-000000000000');
  if (cartErr) console.error("Error deleting cart items:", cartErr);
  else console.log(`Deleted ${cartCount} cart items.`);

  // 5. Delete wishlist_items
  console.log("Deleting wishlist items...");
  const { count: wishlistCount, error: wishlistErr } = await supabase.from('wishlist_items').delete({ count: 'exact' }).neq('id', '00000000-0000-0000-0000-000000000000');
  if (wishlistErr) console.error("Error deleting wishlist items:", wishlistErr);
  else console.log(`Deleted ${wishlistCount} wishlist items.`);

  // 6. Delete reviews
  console.log("Deleting reviews...");
  const { count: reviewsCount, error: reviewsErr } = await supabase.from('reviews').delete({ count: 'exact' }).neq('id', '00000000-0000-0000-0000-000000000000');
  if (reviewsErr) console.error("Error deleting reviews:", reviewsErr);
  else console.log(`Deleted ${reviewsCount} reviews.`);

  // 7. Delete notifications
  console.log("Deleting notifications...");
  const { count: notificationsCount, error: notificationsErr } = await supabase.from('notifications').delete({ count: 'exact' }).neq('id', '00000000-0000-0000-0000-000000000000');
  if (notificationsErr) console.error("Error deleting notifications:", notificationsErr);
  else console.log(`Deleted ${notificationsCount} notifications.`);

  // 8. Delete support_tickets
  console.log("Deleting support tickets...");
  const { count: ticketsCount, error: ticketsErr } = await supabase.from('support_tickets').delete({ count: 'exact' }).neq('id', '00000000-0000-0000-0000-000000000000');
  if (ticketsErr) console.error("Error deleting support tickets:", ticketsErr);
  else console.log(`Deleted ${ticketsCount} support tickets.`);

  // 9. Delete activity_logs
  console.log("Deleting activity logs...");
  const { count: logsCount, error: logsErr } = await supabase.from('activity_logs').delete({ count: 'exact' }).neq('id', '00000000-0000-0000-0000-000000000000');
  if (logsErr) console.error("Error deleting activity logs:", logsErr);
  else console.log(`Deleted ${logsCount} activity logs.`);

  // 10. Delete customers (users with role = 'customer')
  console.log("Deleting users with role = 'customer'...");
  const { count: usersCount, error: usersErr } = await supabase.from('users').delete({ count: 'exact' }).eq('role', 'customer');
  if (usersErr) console.error("Error deleting customer users:", usersErr);
  else console.log(`Deleted ${usersCount} customer users.`);

  console.log("Cleanup completed.");
}

cleanData();
