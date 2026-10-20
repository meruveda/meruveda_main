/**
 * Point every catalogue image at the static files in
 * `frontend/public/images` and drop the dead Supabase URLs.
 *
 * The storefront, the admin app and the backend (invoice PDF, WhatsApp
 * messages) all need an absolute URL they can fetch without knowing which
 * deployment they are running on, so every row is rewritten to
 * `https://meruvedawellness.com/images/<file>`.
 *
 * Idempotent: re-running it produces the same result and no further writes
 * (the script compares the computed value with the stored one and skips the
 * UPDATE when they match).
 *
 * Usage:
 *   node scripts/apply-static-images.js            # dry run + mapping table
 *   node scripts/apply-static-images.js --apply    # write the changes
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('@neondatabase/serverless');

const PUBLIC_BASE = 'https://meruvedawellness.com/images';
const IMAGES_DIR = path.resolve(__dirname, '..', '..', 'frontend', 'public', 'images');
const apply = process.argv.includes('--apply');

/** Static file names that actually exist on disk (the WebP siblings included). */
const available = new Set(fs.readdirSync(IMAGES_DIR));

/** product slug -> [thumbnail, ...gallery] */
const PRODUCT_FILES = {
  'diwali-wellness-hamper': ['product_calm_tea.webp', 'ayurvedic_hero_1783843890311.webp', 'product_ashwagandha.webp'],
  'joint-pain-oil': ['product_pain_oil.webp', 'banner_pain_relief.webp'],
  'liver-detox': ['banner_liver_detox_2.webp', 'banner_liver_detox_1.jpg', 'banner_liver_detox_3.jpg'],
  'pachan-shakti-churna': ['banner_digestive_churna.jpg', 'blog_ashwagandha.webp'],
  'pain-care-kit': ['product_ashwagandha.webp', 'banner_pain_relief.webp'],
  'pain-relief-tablets': ['banner_pain_relief.webp', 'product_pain_oil.webp'],
};

/** banner display_order -> file */
const BANNER_FILES = {
  0: 'banner_liver_detox_3.jpg',
  1: 'product_pain_oil.webp',
  2: 'banner_liver_detox_1.jpg',
  3: 'banner_digestive_churna.jpg',
  4: 'banner_pain_relief.webp',
  5: 'hero_ayurveda.webp',
};

/** category slug -> { image, banner } */
const CATEGORY_FILES = {
  'combo': { image: 'product_calm_tea.webp', banner: 'ayurvedic_hero_1783843890311.webp' },
  'digestive-wellbeing': { image: 'banner_digestive_churna.jpg', banner: 'blog_ashwagandha.webp' },
  'liver-wellbeing': { image: 'banner_liver_detox_1.jpg', banner: 'banner_liver_detox_3.jpg' },
  'pain-relief': { image: 'product_pain_oil.webp', banner: 'banner_pain_relief.webp' },
};

/** blog slug -> file */
const BLOG_FILES = {
  'ayurveda-vs-allopathy-vs-homeopathy-understanding-the-three-paths-to-healing': 'ayurvedic_lab_1783843904446.webp',
  'ayurvedic-herbs-traditionally-associated-with-liver-wellness': 'banner_liver_detox_1.jpg',
  'fatty-liver-an-ayurvedic-perspective-and-simple-lifestyle-tips-for-better-liver-health': 'banner_liver_detox_3.jpg',
  'home-remedies-for-back-pain-headache-muscle-pain-simple-tips-for-everyday-relief': 'blog_essential_oils.jpg',
  'what-is-ayurved-a-beginners-guide-to-indias-timeless-wellness-system': 'ayurvedic_hero_1783843890311.webp',
};

/** Fallback for media rows whose old URL is not referenced anywhere else. */
const MEDIA_BUCKET_FALLBACK = {
  'banners': 'banner_liver_detox_1.jpg',
  'journal': 'ayurvedic_lab_1783843904446.webp',
  'general-media': 'product_calm_tea.webp',
};

const url = (file) => `${PUBLIC_BASE}/${file}`;

function assertFile(file, where) {
  if (!available.has(file)) {
    throw new Error(`Missing static file "${file}" referenced by ${where} (not in frontend/public/images)`);
  }
}

function mimeFor(file) {
  if (/\.webp$/i.test(file)) return 'image/webp';
  if (/\.png$/i.test(file)) return 'image/png';
  if (/\.jpe?g$/i.test(file)) return 'image/jpeg';
  if (/\.svg$/i.test(file)) return 'image/svg+xml';
  return 'application/octet-stream';
}

function sizeFor(file) {
  return fs.statSync(path.join(IMAGES_DIR, file)).size;
}

async function main() {
  for (const [slug, files] of Object.entries(PRODUCT_FILES)) files.forEach((f) => assertFile(f, `product ${slug}`));
  for (const [order, file] of Object.entries(BANNER_FILES)) assertFile(file, `banner display_order=${order}`);
  for (const [slug, v] of Object.entries(CATEGORY_FILES)) {
    assertFile(v.image, `category ${slug}.image`);
    assertFile(v.banner, `category ${slug}.banner`);
  }
  for (const [slug, file] of Object.entries(BLOG_FILES)) assertFile(file, `blog ${slug}`);

  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL / DATABASE_URL_UNPOOLED is not configured.');

  const client = new Pool({ connectionString: url, max: 1 });
  await client.connect();

  const mapping = [];
  const plan = { products: [], banners: [], categories: [], blogs: [], media: [], orderItems: [] };

  try {
    await client.query('BEGIN');

    // ---- products -------------------------------------------------------
    const products = (await client.query('SELECT id, name, slug, images FROM products ORDER BY slug')).rows;
    const productThumb = new Map();
    for (const p of products) {
      const files = PRODUCT_FILES[p.slug];
      if (!files) {
        mapping.push({ slot: 'products', row: `${p.slug}`, file: '(none)', confidence: 'NONE', note: 'no static match — images left untouched' });
        continue;
      }
      const images = files.map((file, i) => ({
        id: i === 0 ? 'img-thumb' : `img-${i}`,
        alt: p.name,
        url: url(file),
      }));
      productThumb.set(p.id, images[0].url);
      plan.products.push({ id: p.id, slug: p.slug, images });
      mapping.push({ slot: 'products', row: `${p.slug}`, file: files.join(', '), confidence: 'HIGH', note: `thumb=${files[0]}` });
    }

    // ---- banners --------------------------------------------------------
    const banners = (await client.query('SELECT id, heading, display_order, image_url FROM banners ORDER BY display_order')).rows;
    for (const b of banners) {
      const file = BANNER_FILES[b.display_order];
      if (!file) {
        mapping.push({ slot: 'banners', row: `display_order=${b.display_order} (${b.heading})`, file: '(none)', confidence: 'NONE', note: 'left untouched' });
        continue;
      }
      plan.banners.push({ id: b.id, file });
      mapping.push({ slot: 'banners', row: `display_order=${b.display_order} (${b.heading})`, file, confidence: 'HIGH', note: '' });
    }

    // ---- categories -----------------------------------------------------
    const categories = (await client.query('SELECT id, name, slug, image, banner FROM categories ORDER BY slug')).rows;
    for (const c of categories) {
      const files = CATEGORY_FILES[c.slug];
      if (!files) {
        mapping.push({ slot: 'categories', row: c.slug, file: '(none)', confidence: 'NONE', note: 'left untouched' });
        continue;
      }
      plan.categories.push({ id: c.id, image: files.image, banner: files.banner });
      mapping.push({ slot: 'categories', row: c.slug, file: `image=${files.image}, banner=${files.banner}`, confidence: 'HIGH', note: '' });
    }

    // ---- blogs ----------------------------------------------------------
    const blogs = (await client.query('SELECT id, title, slug, featured_image FROM blogs ORDER BY slug')).rows;
    for (const b of blogs) {
      const file = BLOG_FILES[b.slug];
      if (!file) {
        mapping.push({ slot: 'blogs', row: b.slug, file: '(none)', confidence: 'NONE', note: 'left untouched' });
        continue;
      }
      plan.blogs.push({ id: b.id, file });
      mapping.push({ slot: 'blogs', row: b.slug.slice(0, 58), file, confidence: 'HIGH', note: '' });
    }

    // ---- old URL -> new URL correlation ---------------------------------
    const oldToNew = new Map();
    const remember = (oldUrl, newUrl) => {
      if (oldUrl && !oldToNew.has(oldUrl)) oldToNew.set(oldUrl, newUrl);
    };
    // Thumbnails win the tie, so they are registered first.
    for (const p of products) {
      const files = PRODUCT_FILES[p.slug];
      if (!files) continue;
      const olds = Array.isArray(p.images) ? p.images.map((i) => (i && i.url) || i).filter(Boolean) : [];
      if (olds[0]) remember(olds[0], url(files[0]));
    }
    for (const b of banners) {
      const file = BANNER_FILES[b.display_order];
      if (file) remember(b.image_url, url(file));
    }
    for (const b of blogs) {
      const file = BLOG_FILES[b.slug];
      if (file) remember(b.featured_image, url(file));
    }
    for (const p of products) {
      const files = PRODUCT_FILES[p.slug];
      if (!files) continue;
      const olds = Array.isArray(p.images) ? p.images.map((i) => (i && i.url) || i).filter(Boolean) : [];
      olds.forEach((oldUrl, i) => {
        if (i === 0) return;
        remember(oldUrl, url(files[i % files.length]));
      });
    }

    // ---- media ----------------------------------------------------------
    const media = (await client.query('SELECT id, filename, public_url, bucket FROM media ORDER BY id')).rows;
    for (const m of media) {
      let file = null;
      let confidence = 'HIGH';
      const direct = oldToNew.get(m.public_url);
      if (direct) {
        file = direct.slice(PUBLIC_BASE.length + 1);
      } else {
        file = MEDIA_BUCKET_FALLBACK[m.bucket] || MEDIA_BUCKET_FALLBACK['general-media'];
        confidence = 'LOW';
      }
      plan.media.push({ id: m.id, file });
      mapping.push({
        slot: 'media',
        row: `${m.filename} [${m.bucket}]`,
        file,
        confidence,
        note: direct ? 'matched the row it backed' : 'bucket fallback',
      });
    }

    // ---- order_items ----------------------------------------------------
    const items = (await client.query('SELECT id, product_id, product_name, image_url FROM order_items ORDER BY id')).rows;
    for (const it of items) {
      const thumb = productThumb.get(it.product_id);
      if (!thumb) {
        mapping.push({ slot: 'order_items', row: `${it.product_name}`, file: '(none)', confidence: 'NONE', note: 'product not found' });
        continue;
      }
      plan.orderItems.push({ id: it.id, thumb });
      mapping.push({ slot: 'order_items', row: `${it.product_name}`, file: thumb.slice(PUBLIC_BASE.length + 1), confidence: 'HIGH', note: 'taken from the product thumbnail' });
    }

    // ---- apply ----------------------------------------------------------
    const applied = { products: 0, banners: 0, categories: 0, blogs: 0, media: 0, orderItems: 0 };

    for (const p of plan.products) {
      const r = await client.query('UPDATE products SET images = $2::jsonb, updated_at = now() WHERE id = $1 AND images IS DISTINCT FROM $2::jsonb', [p.id, JSON.stringify(p.images)]);
      applied.products += r.rowCount;
    }
    for (const b of plan.banners) {
      const r = await client.query('UPDATE banners SET image_url = $2, updated_at = now() WHERE id = $1 AND image_url IS DISTINCT FROM $2', [b.id, url(b.file)]);
      applied.banners += r.rowCount;
    }
    for (const c of plan.categories) {
      const r = await client.query('UPDATE categories SET image = $2, banner = $3 WHERE id = $1 AND (image IS DISTINCT FROM $2 OR banner IS DISTINCT FROM $3)', [c.id, url(c.image), url(c.banner)]);
      applied.categories += r.rowCount;
    }
    for (const b of plan.blogs) {
      const r = await client.query('UPDATE blogs SET featured_image = $2, updated_at = now() WHERE id = $1 AND featured_image IS DISTINCT FROM $2', [b.id, url(b.file)]);
      applied.blogs += r.rowCount;
    }
    for (const m of plan.media) {
      const r = await client.query(
        `UPDATE media
            SET public_url = $2,
                storage_path = '',
                mime_type = $3,
                size = $4
          WHERE id = $1
            AND (public_url IS DISTINCT FROM $2 OR storage_path IS DISTINCT FROM '' OR mime_type IS DISTINCT FROM $3 OR size IS DISTINCT FROM $4)`,
        [m.id, url(m.file), mimeFor(m.file), sizeFor(m.file)],
      );
      applied.media += r.rowCount;
    }
    for (const it of plan.orderItems) {
      const r = await client.query('UPDATE order_items SET image_url = $2 WHERE id = $1 AND image_url IS DISTINCT FROM $2', [it.id, it.thumb]);
      applied.orderItems += r.rowCount;
    }

    // ---- verification ---------------------------------------------------
    const leftovers = await client.query(
      `SELECT 'products.images' AS slot, count(*)::int AS n FROM products WHERE images::text ILIKE '%supabase%'
       UNION ALL SELECT 'banners.image_url', count(*)::int FROM banners WHERE image_url ILIKE '%supabase%'
       UNION ALL SELECT 'categories.image', count(*)::int FROM categories WHERE image ILIKE '%supabase%' OR banner ILIKE '%supabase%'
       UNION ALL SELECT 'blogs.featured_image', count(*)::int FROM blogs WHERE featured_image ILIKE '%supabase%'
       UNION ALL SELECT 'media.public_url', count(*)::int FROM media WHERE public_url ILIKE '%supabase%'
       UNION ALL SELECT 'order_items.image_url', count(*)::int FROM order_items WHERE image_url ILIKE '%supabase%'`,
    );

    if (apply) {
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }

    console.log(`\n${apply ? 'APPLIED' : 'DRY RUN'} — rows written:`, applied);
    console.log('\nRemaining supabase URLs per column:');
    for (const row of leftovers.rows) console.log(`  ${row.slot.padEnd(22)} ${row.n}`);

    // ---- mapping report -------------------------------------------------
    const lines = [];
    lines.push('# Static image mapping');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');
    lines.push(`Public base: \`${PUBLIC_BASE}\``);
    lines.push('');
    lines.push('| slot | DB row | file | confidence | note |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const m of mapping) {
      lines.push(`| ${m.slot} | ${m.row} | ${m.file} | ${m.confidence} | ${m.note} |`);
    }
    const outDir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'image-mapping.md'), lines.join('\n'));
    console.log('\nMapping table written to backend/backups/image-mapping.md');
    console.log('\n| slot | DB row | file | confidence |');
    console.log('| --- | --- | --- | --- |');
    for (const m of mapping) console.log(`| ${m.slot} | ${m.row} | ${m.file} | ${m.confidence} |`);
  } finally {
    try { await client.query('ROLLBACK'); } catch { /* not in a transaction */ }
    await client.end();
  }
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
