const fs = require('fs');
const path = require('path');

const piecesDir = path.join(__dirname, 'public', 'assets', 'pieces');
const targetFile = path.join(__dirname, 'public', 'js', 'pieces.js');

const mapping = {
  'wk': 'wK.svg',
  'wq': 'wQ.svg',
  'wr': 'wR.svg',
  'wb': 'wB.svg',
  'wn': 'wN.svg',
  'wp': 'wP.svg',
  'bk': 'bK.svg',
  'bq': 'bQ.svg',
  'br': 'bR.svg',
  'bb': 'bB.svg',
  'bn': 'bN.svg',
  'bp': 'bP.svg'
};

let out = '// Official Tournament Staunton Chess Vectors (Lichess Standard)\n';
out += 'const pieces = {\n';

for (const [key, filename] of Object.entries(mapping)) {
  const filePath = path.join(piecesDir, filename);
  let svg = fs.readFileSync(filePath, 'utf8').trim();

  // Standardize viewBox and sizing
  if (!svg.includes('viewBox')) {
    svg = svg.replace('<svg', '<svg viewBox="0 0 45 45"');
  }
  // Replace static width/height with 100%
  svg = svg.replace(/\s(width|height)="[^"]*"/g, '');
  svg = svg.replace('<svg', '<svg width="100%" height="100%"');

  out += `  '${key}': \`${svg}\`,\n`;
}

out += '};\n\nexport default pieces;\n';

fs.writeFileSync(targetFile, out, 'utf8');
console.log('Successfully generated public/js/pieces.js!');
