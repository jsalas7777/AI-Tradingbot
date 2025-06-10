const fs = require('fs');
const path = require('path');

// === Configuration ===
const inputFilePath = path.join(__dirname, '/sequence/normalized.csv');
const outputFilePath = path.join(__dirname, '/sequence/training_dataset.csv');
const inputSize = 144;
const labelSize = 12;

// === Read and parse the CSV ===
const rawData = fs.readFileSync(inputFilePath, 'utf8');
const lines = rawData.trim().split('\n').slice(1); // Skip header

// === Extract only percentage_change values ===
const values = lines.map(line => {
  const parts = line.split(',');
  return parseFloat(parts[1]);
});

// === Prepare headers ===
const featureHeaders = Array.from({ length: inputSize }, (_, i) => `feature_${i + 1}`);
const labelHeaders = Array.from({ length: labelSize }, (_, i) => `label_${i + 1}`);
const headers = [...featureHeaders, ...labelHeaders].join(',');

// === Generate dataset rows ===
let rows = [headers];

for (let i = 0; i <= values.length - (inputSize + labelSize); i++) {
  const features = values.slice(i, i + inputSize);
  const labels = values.slice(i + inputSize, i + inputSize + labelSize);
  rows.push([...features, ...labels].join(','));
}

// === Save to CSV ===
fs.writeFileSync(outputFilePath, rows.join('\n'));
console.log(`✅ Dataset created: ${outputFilePath}`);
