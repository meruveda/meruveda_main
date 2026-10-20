/** Temporary diagnostic: dump every image-bearing column so the mapping can be built. */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
import { many } from '../../src/database/db';

async function main() {
  const products = await many(
    `SELECT id, name, slug, sku, category_id, images, status
       FROM products ORDER BY name`,
  );
  const banners = await many(
    `SELECT id, heading, subheading, image_url, display_order, is_active
       FROM banners ORDER BY display_order NULLS LAST, id`,
  );
  const categories = await many(
    `SELECT id, name, slug, image, banner FROM categories ORDER BY name`,
  );
  const blogs = await many(
    `SELECT id, title, slug, featured_image, status FROM blogs ORDER BY title`,
  );
  const media = await many(`SELECT * FROM media ORDER BY filename`);
  const orderItems = await many(
    `SELECT id, order_id, product_id, product_name, image_url FROM order_items ORDER BY id`,
  );
  const settings = await many(`SELECT key, value FROM settings ORDER BY key`);

  console.log('=== PRODUCTS ===');
  console.log(JSON.stringify(products, null, 2));
  console.log('=== BANNERS ===');
  console.log(JSON.stringify(banners, null, 2));
  console.log('=== CATEGORIES ===');
  console.log(JSON.stringify(categories, null, 2));
  console.log('=== BLOGS ===');
  console.log(JSON.stringify(blogs, null, 2));
  console.log('=== MEDIA ===');
  console.log(JSON.stringify(media, null, 2));
  console.log('=== ORDER_ITEMS ===');
  console.log(JSON.stringify(orderItems, null, 2));
  console.log('=== SETTINGS ===');
  console.log(JSON.stringify(settings, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('ERR', e?.message || e);
    process.exit(1);
  });
