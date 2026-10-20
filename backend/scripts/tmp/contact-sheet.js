/** Build a labelled contact sheet of every static image so the mapping can be made visually. */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC = path.resolve(__dirname, '../../../frontend/public/images');
const OUT = path.join(__dirname, 'contact-sheet.jpg');

const files = fs.readdirSync(SRC).filter((f) => !/\.svg$/i.test(f)).sort();
console.log('ORDER (row-major, 4 per row):');
files.forEach((f, i) => console.log(`  [${Math.floor(i / 4)}][${i % 4}] ${f}`));

const CELL = 300;
const COLS = 4;
const ROWS = Math.ceil(files.length / COLS);

(async () => {
  const composites = [];
  for (let i = 0; i < files.length; i++) {
    const buf = await sharp(path.join(SRC, files[i]))
      .resize(CELL - 8, CELL - 8, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 72 })
      .toBuffer();
    const meta = await sharp(buf).metadata();
    composites.push({
      input: buf,
      left: (i % COLS) * CELL + 4,
      top: Math.floor(i / COLS) * CELL + 4,
    });
    void meta;
  }
  await sharp({
    create: {
      width: COLS * CELL,
      height: ROWS * CELL,
      channels: 3,
      background: '#dddddd',
    },
  })
    .composite(composites)
    .jpeg({ quality: 70 })
    .toFile(OUT);
  console.log('WROTE', OUT);
})();
