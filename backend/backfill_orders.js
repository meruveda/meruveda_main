const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: 'd:/projects/MeruVeda/backend/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function backfill() {
  try {
    console.log("Starting backfill for historical orders...");
    
    // Fetch order items that have 'Unknown Product' or are missing name
    const { data: orderItems, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .or('product_name.eq.Unknown Product,product_name.is.null');

    if (itemsError) {
      throw itemsError;
    }

    console.log(`Found ${orderItems.length} order items needing backfill.`);

    if (orderItems.length === 0) {
      console.log("No order items need backfilling.");
      return;
    }

    // Get unique product IDs
    const productIds = [...new Set(orderItems.map(item => item.product_id).filter(Boolean))];
    console.log(`Fetching product details for ${productIds.length} unique products...`);

    // Fetch product details
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, name, sku')
      .in('id', productIds);

    if (productsError) {
      throw productsError;
    }

    const productMap = new Map(products.map(p => [p.id, p]));
    console.log("Product mapping complete. Updating order items...");

    let updatedCount = 0;
    for (const item of orderItems) {
      const product = productMap.get(item.product_id);
      if (product) {
        const updateData = {};
        if (!item.product_name || item.product_name === 'Unknown Product') {
          updateData.product_name = product.name;
        }
        if (!item.sku || item.sku.startsWith('SKU-') || item.sku === '') {
          // If the sku was a fallback/placeholder SKU or empty, update it too
          updateData.sku = product.sku;
        }

        if (Object.keys(updateData).length > 0) {
          const { error: updateError } = await supabase
            .from('order_items')
            .update(updateData)
            .eq('id', item.id);

          if (updateError) {
            console.error(`Error updating order item ${item.id}:`, updateError);
          } else {
            updatedCount++;
          }
        }
      } else {
        console.warn(`Product not found for ID ${item.product_id} in order item ${item.id}`);
      }
    }

    console.log(`Successfully backfilled ${updatedCount} order items.`);
  } catch (err) {
    console.error("Backfill failed:", err);
  }
}

backfill();
