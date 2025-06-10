const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Input and output files
const inputPath = path.join(__dirname, '/verified_bybit_data/TRUMPUSDT_kline_data.csv');
const outputPath = path.join(__dirname, '/sequence/normalized.csv');

async function processCSV() {
  const rl = readline.createInterface({
    input: fs.createReadStream(inputPath),
    crlfDelay: Infinity,
  });

  const output = fs.createWriteStream(outputPath);
  output.write('timestamp,percentage_change\n'); // Header

  let isFirstLine = true;

  for await (const line of rl) {
    if (isFirstLine) {
      isFirstLine = false; // Skip header
      continue;
    }

    const [timestamp, open, , , close] = line.split(',');

    const openPrice = parseFloat(open);
    const closePrice = parseFloat(close);

    if (!isNaN(openPrice) && !isNaN(closePrice)) {
      const change = ((closePrice - openPrice) / openPrice) * 100;
      output.write(`${timestamp},${change.toFixed(4)}\n`);
    }
  }

  output.close();
  console.log('CSV file with percentage changes generated.');
}

processCSV();
