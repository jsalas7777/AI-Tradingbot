const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');

// Load and shuffle CSV dataset
function loadAndShuffleDataset(csvPath) {
  const csv = fs.readFileSync(csvPath, 'utf8');
  const lines = csv.trim().split('\n');
  const data = lines.slice(1).map(row => row.split(',').map(Number));

  // Shuffle rows
  for (let i = data.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [data[i], data[j]] = [data[j], data[i]];
  }

  const xs = data.map(row => row.slice(0, 144));
  const ys = data.map(row => row.slice(144));

  return {
    xs: tf.tensor2d(xs),     // shape: [batchSize, 144]
    ys: tf.tensor2d(ys),
    rawInputs: xs,
    rawLabels: ys
  };
}

async function evaluateModel() {
  const { xs, ys, rawInputs, rawLabels } = loadAndShuffleDataset('./sequence/training_dataset.csv');

  // Reshape xs to [batchSize, 144, 1] as expected by Conv1D
  const reshapedXs = xs.reshape([xs.shape[0], xs.shape[1], 1]);

  const model = await tf.loadLayersModel('file://./latest_model_conv1d/model.json');

  const preds = model.predict(reshapedXs);
  const mae = tf.metrics.meanAbsoluteError(ys, preds);
  const maeScalar = await mae.mean().array();

  console.log(`📊 Mean Absolute Error (overall): ${maeScalar.toFixed(4)}`);

  // Show 3 detailed comparisons
  const predArr = await preds.array();
  for (let i = 0; i < 3; i++) {
    console.log(`\n🔢 Sample ${i + 1}`);
    console.log(`🧬 Input Seq (first 10 shown): ${rawInputs[i].slice(0, 10).join(', ')} ...`);
    console.log(`🤖 Predicted Labels: ${predArr[i].map(n => n.toFixed(2)).join(', ')}`);
    console.log(`✅ Actual Labels:    ${rawLabels[i].join(', ')}`);
  }
}

evaluateModel().catch(console.error);
