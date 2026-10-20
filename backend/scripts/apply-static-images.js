/**
 * Point every catalogue image at the static files in
 * `frontend/public/images`.
 *
 * The storefront, the admin app and the backend (invoice PDF, WhatsApp
 * messages) all need one absolute URL they can fetch without knowing which
 * deployment they run on, so every row is rewritten to
 * `https://meruvedawellness.com/images/<file>` — same origin as the site,
 * served straight from the repository, no object storage in the hot path.
 *
 * Idempotent: a row whose value already matches is skipped, so a re-run
 * writes nothing.
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

/**
 * The original storage object name -> the static file that replaces it.
 *
 * The names come from the pre-migration object keys (the Supabase bucket
 * object names), which are still embedded in the current `media.public_url`
 * path (`media/<bucket>/<object>/0-1254.webp`), so every media row can be
 * matched to the asset it actually backed instead of to a bucket guess.
 */
const MEDIA_OBJECT_MAP = {
  // ---- product photography (general-media) ----------------------------
  '1786817771357-rgzi4f': 'product_calm_tea.webp',            // Diwali Wellness Hamper (thumbnail)
  '1787726250704-plzt5k': 'ayurvedic_hero_1783843890311.webp',
  '1787726434358-c162yh': 'product_ashwagandha.webp',
  '1787726543388-ief735': 'banner_digestive_churna.jpg',       // Pachan Shakti Churna
  '1787726482047-nsv79': 'banner_liver_detox_1.jpg',           // Liver Detox
  '1787726998529-k38n99b': 'product_ashwagandha.webp',         // Pain Care Kit (thumbnail)
  '1787726999398-cb00v8': 'banner_pain_relief.webp',           // Pain Care Kit
  '1787726999237-xy3py5': 'product_calm_tea.webp',
  '1787726998710-gndfic': 'ayurvedic_hero_1783843890311.webp',
  '1787726251326-c13q1': 'product_pain_oil.webp',             // Joint Pain Oil (thumbnail)
  '1787726251197-6sbz53': 'banner_pain_relief.webp',
  '1787726251422-z5iifh': 'product_pain_oil.webp',
  '1787726250132-2wu0g5': 'banner_pain_relief.webp',
  '1787726481631-8wshj': 'banner_liver_detox_2.webp',          // Liver Detox (thumbnail)
  '1787726481854-8sqz98': 'banner_liver_detox_1.jpg',
  '1787726482018-a2vnww': 'banner_liver_detox_3.jpg',
  '1787726481893-x9goz': 'banner_liver_detox_2.webp',
  '1787726482556-xg4b4p': 'banner_liver_detox_1.jpg',
  '1787726543501-l1kylr': 'banner_digestive_churna.jpg',       // Pachan Shakti Churna (thumbnail)
  '1787726543865-jp19ac': 'banner_digestive_churna.jpg',
  '1787726543597-im7rpl': 'banner_digestive_churna.jpg',
  '1787726543954-pzcx2s': 'banner_digestive_churna.jpg',
  '1787726544048-db5mx': 'banner_digestive_churna.jpg',
  '1787727447112-jgiojn': 'product_ashwagandha.webp',         // Pain Care Kit
  '1787726434171-8gzj9m': 'banner_pain_relief.webp',           // Pain Relief Tablets
  '1787726434300-2i7y4b': 'banner_pain_relief.webp',
  '1787726434147-zrz1gr': 'banner_pain_relief.webp',
  '1787726434611-tw4gwv': 'banner_pain_relief.webp',           // Pain Relief Tablets (thumbnail)
  // ---- banners --------------------------------------------------------
  '1784926599495-8dmsc3': 'banner_liver_detox_3.jpg',          // banner "Last"
  '1784917316027-o1d0c7': 'product_pain_oil.webp',             // banner "Pain Oil"
  '1784918457292-ot1rpp': 'banner_liver_detox_1.jpg',          // banner "Liver"
  '1784920785629-vdvk6': 'banner_digestive_churna.jpg',        // banner "Digestive"
  '1784925578188-t7wedl': 'banner_pain_relief.webp',           // banner "Pain Tablets"
  '1784834252551-ylw78': 'hero_ayurveda.webp',                 // banner "Main"
  '1784834166845-p7yl2j': 'banner_liver_detox_1.jpg',          // unused banner asset
  // ---- journal --------------------------------------------------------
  '1785405077587-8vaacp': 'ayurvedic_lab_1783843904446.webp',  // journal cover
};

/** The original object name still embedded in the current media URL path. */
function objectNameOf(publicUrl) {
  const m = /\/media\/[^/]+\/([^/]+)\//.exec(String(publicUrl || ''));
  return m ? m[1] : null;
}

const publicUrl = (file) => `${PUBLIC_BASE}/${file}`;

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

  // The Neon serverless Pool speaks WebSocket, which only the pooled
  // ("-pooler.") endpoint supports — the direct host hangs on connect.
  const connectionString = process.env.DATABASE_URL || process.env.DATABASE_URL_APP;
  if (!connectionString) throw new Error('DATABASE_URL / DATABASE_URL_APP is not configured.');

  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 15_000,
    query_timeout: 30_000,
    statement_timeout: 30_000,
  });
  const client = await pool.connect();

  const mapping = [];
  const applied = { products: 0, banners: 0, categories: 0, blogs: 0, media: 0, orderItems: 0 };

  try {
    await client.query('BEGIN');

    // ---- products -------------------------------------------------------
    const products = (await client.query('SELECT id, name, slug, images FROM products ORDER BY slug')).rows;
    const productThumb = new Map();
    for (const p of products) {
      const files = PRODUCT_FILES[p.slug];
      if (!files) {
        mapping.push({ slot: 'products', row: p.slug, file: '(no static match)', confidence: 'NONE' });
        continue;
      }
      const images = files.map((file, i) => ({ id: i === 0 ? 'img-thumb' : `img-${i}`, alt: p.name, url: publicUrl(file) }));
      productThumb.set(p.id, images[0].url);
      const r = await client.query(
        'UPDATE products SET images = $2::jsonb, updated_at = now() WHERE id = $1 AND images IS DISTINCT FROM $2::jsonb',
        [p.id, JSON.stringify(images)],
      );
      applied.products += r.rowCount;
      mapping.push({ slot: 'products', row: p.slug, file: files.join(', '), confidence: 'HIGH' });
    }

    // ---- banners --------------------------------------------------------
    const banners = (await client.query('SELECT id, heading, display_order, image_url FROM banners ORDER BY display_order')).rows;
    for (const b of banners) {
      const file = BANNER_FILES[b.display_order];
      if (!file) {
        mapping.push({ slot: 'banners', row: `display_order=${b.display_order} (${b.heading})`, file: '(no static match)', confidence: 'NONE' });
        continue;
      }
      const r = await client.query(
        'UPDATE banners SET image_url = $2, updated_at = now() WHERE id = $1 AND image_url IS DISTINCT FROM $2',
        [b.id, publicUrl(file)],
      );
      applied.banners += r.rowCount;
      mapping.push({ slot: 'banners', row: `display_order=${b.display_order} (${b.heading})`, file, confidence: 'HIGH' });
    }

    // ---- categories -----------------------------------------------------
    const categories = (await client.query('SELECT id, name, slug, image, banner FROM categories ORDER BY slug')).rows;
    for (const c of categories) {
      const files = CATEGORY_FILES[c.slug];
      if (!files) {
        mapping.push({ slot: 'categories', row: c.slug, file: '(no static match)', confidence: 'NONE' });
        continue;
      }
      const r = await client.query(
        'UPDATE categories SET image = $2, banner = $3 WHERE id = $1 AND (image IS DISTINCT FROM $2 OR banner IS DISTINCT FROM $3)',
        [c.id, publicUrl(files.image), publicUrl(files.banner)],
      );
      applied.categories += r.rowCount;
      mapping.push({ slot: 'categories', row: c.slug, file: `image=${files.image}, banner=${files.banner}`, confidence: 'HIGH' });
    }

    // ---- blogs ----------------------------------------------------------
    const blogs = (await client.query('SELECT id, title, slug, featured_image FROM blogs ORDER BY slug')).rows;
    for (const b of blogs) {
      const file = BLOG_FILES[b.slug];
      if (!file) {
        mapping.push({ slot: 'blogs', row: b.slug.slice(0, 56), file: '(no static match)', confidence: 'NONE' });
        continue;
      }
      const r = await client.query(
        'UPDATE blogs SET featured_image = $2, updated_at = now() WHERE id = $1 AND featured_image IS DISTINCT FROM $2',
        [b.id, publicUrl(file)],
      );
      applied.blogs += r.rowCount;
      mapping.push({ slot: 'blogs', row: b.slug.slice(0, 56), file, confidence: 'HIGH' });
    }

    // ---- media ----------------------------------------------------------
    // The old URL told us which row backed which asset; the R2 migration kept
    // the same file names, so the media rows are matched by their bucket and
    // by the slot they were used in.
    const media = (await client.query('SELECT id, filename, public_url, bucket FROM media ORDER BY id')).rows;
    for (const m of media) {
      // Already pointing at the static host: nothing to do (keeps the script
      // idempotent even after the object name disappeared from the URL).
      if (String(m.public_url).startsWith(`${PUBLIC_BASE}/`)) {
        mapping.push({ slot: 'media', row: `${m.filename} [${m.bucket}]`, file: String(m.public_url).slice(PUBLIC_BASE.length + 1), confidence: 'ALREADY' });
        continue;
      }
      const objectName = objectNameOf(m.public_url);
      const matched = objectName ? MEDIA_OBJECT_MAP[objectName] : null;
      const file = matched || MEDIA_BUCKET_FALLBACK[m.bucket] || MEDIA_BUCKET_FALLBACK['general-media'];
      const r = await client.query(
        `UPDATE media
            SET public_url = $2,
                storage_path = '',
                mime_type = $3,
                size = $4
          WHERE id = $1
            AND (public_url IS DISTINCT FROM $2 OR storage_path IS DISTINCT FROM '' OR mime_type IS DISTINCT FROM $3 OR size IS DISTINCT FROM $4)`,
        [m.id, publicUrl(file), mimeFor(file), sizeFor(file)],
      );
      applied.media += r.rowCount;
      mapping.push({ slot: 'media', row: `${m.filename} [${m.bucket}]`, file, confidence: matched ? 'HIGH' : 'LOW' });
    }

    // ---- order_items ----------------------------------------------------
    const items = (await client.query('SELECT id, product_id, product_name, image_url FROM order_items ORDER BY id')).rows;
    for (const it of items) {
      const thumb = productThumb.get(it.product_id);
      if (!thumb) {
        mapping.push({ slot: 'order_items', row: it.product_name, file: '(product not found)', confidence: 'NONE' });
        continue;
      }
      const r = await client.query(
        'UPDATE order_items SET image_url = $2 WHERE id = $1 AND image_url IS DISTINCT FROM $2',
        [it.id, thumb],
      );
      applied.orderItems += r.rowCount;
      mapping.push({ slot: 'order_items', row: it.product_name, file: thumb.slice(PUBLIC_BASE.length + 1), confidence: 'HIGH' });
    }

    // ---- verification ---------------------------------------------------
    const leftovers = await client.query(
      `SELECT 'products.images' AS slot, count(*)::int AS n FROM products WHERE images::text ILIKE '%supabase%'
       UNION ALL SELECT 'banners.image_url', count(*)::int FROM banners WHERE image_url ILIKE '%supabase%'
       UNION ALL SELECT 'categories.image/banner', count(*)::int FROM categories WHERE image ILIKE '%supabase%' OR banner ILIKE '%supabase%'
       UNION ALL SELECT 'blogs.featured_image', count(*)::int FROM blogs WHERE featured_image ILIKE '%supabase%'
       UNION ALL SELECT 'media.public_url', count(*)::int FROM media WHERE public_url ILIKE '%supabase%'
       UNION ALL SELECT 'order_items.image_url', count(*)::int FROM order_items WHERE image_url ILIKE '%supabase%'`,
    );

    if (apply) await client.query('COMMIT');
    else await client.query('ROLLBACK');

    console.log(`${apply ? 'APPLIED' : 'DRY RUN'} — rows written:`, applied);
    console.log('\nRemaining supabase URLs per column:');
    for (const row of leftovers.rows) console.log(`  ${row.slot.padEnd(22)} ${row.n}`);

    const outDir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(outDir, { recursive: true });
    const lines = [
      '# Static image mapping',
      '',
      `Generated: ${new Date().toISOString()}`,
      '',
      `Public base: \`${PUBLIC_BASE}\``,
      '',
      '| slot | DB row | file | confidence |',
      '| --- | --- | --- | --- |',
      ...mapping.map((m) => `| ${m.slot} | ${m.row} | ${m.file} | ${m.confidence} |`),
      '',
    ];
    fs.writeFileSync(path.join(outDir, 'image-mapping.md'), lines.join('\n'));
    console.log('\nMapping table written to backend/backups/image-mapping.md');
    console.log('\n| slot | DB row | file | confidence |');
    console.log('| --- | --- | --- | --- |');
    for (const m of mapping) console.log(`| ${m.slot} | ${m.row} | ${m.file} | ${m.confidence} |`);
  } finally {
    try { await client.query('ROLLBACK'); } catch { /* already committed or rolled back */ }
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
