const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: 'd:/projects/MeruVeda/backend/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function backfillSkus() {
  try {
    console.log("Starting SKU backfill...");
    const { data: orderItems, error } = await supabase.from('order_items').select('*');
    if (error) throw error;

    console.log(`Found ${orderItems.length} order items to inspect.`);
    let updated = 0;

    for (const item of orderItems) {
      // Check if SKU is numeric or missing
      if (!item.sku || /^\d+$/.test(item.sku) || item.sku === '') {
        const fallbackSku = `SKU-${item.product_id.substring(0, 8).toUpperCase()}`;
        console.log(`Updating order item ${item.id} SKU from '${item.sku}' to '${fallbackSku}'`);
        
        const { error: updateError } = await supabase
          .from('order_items')
          .update({ sku: fallbackSku })
          .eq('id', item.id);

        if (updateError) {
          console.error(`Failed to update item ${item.id}:`, updateError);
        } else {
          updated++;
        }
      }
    }

    console.log(`SKU backfill complete. Updated ${updated} items.`);
  } catch (err) {
    console.error("Error during SKU backfill:", err);
  }
}

backfillSkus();
