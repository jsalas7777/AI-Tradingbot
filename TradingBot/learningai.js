const tf = require("@tensorflow/tfjs-node");
const fs = require("fs");

async function loadDataset(csvPath) {
  const csv = fs.readFileSync(csvPath, "utf8");
  const lines = csv.trim().split("\n");
  const data = lines.slice(1).map((row) => row.split(",").map(Number));

  const xs = data.map((row) => row.slice(0, 144));
  const ys = data.map((row) => row.slice(144));

  const xsTensor = tf.tensor2d(xs);
  const ysTensor = tf.tensor2d(ys);

  // Normalize ys
  const ysMean = ysTensor.mean();
  const ysStd = ysTensor.sub(ysMean).square().mean().sqrt();
  const normalizedYs = ysTensor.sub(ysMean).div(ysStd);

  // Print stats
  ysMean.print();
  ysStd.print();

  const reshapedXs = xsTensor.reshape([xsTensor.shape[0], xsTensor.shape[1], 1]);

  return {
    xs: reshapedXs,
    ys: normalizedYs,
    rawYs: ysTensor,
    ysMean,
    ysStd,
    numRows: xsTensor.shape[0],
  };
}

async function run() {
  const { xs, ys, rawYs, ysMean, ysStd } = await loadDataset("./sequence/training_dataset.csv");

  let currentLr = 0.001;
  let optimizer = tf.train.adam(currentLr);

  const model = tf.sequential();

  // === MODEL ARCHITECTURE ===
  model.add(tf.layers.conv1d({
    inputShape: [144, 1],
    filters: 128,
    kernelSize: 5,
    activation: 'linear',
  }));
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.leakyReLU({ alpha: 0.1 }));

  model.add(tf.layers.conv1d({
    filters: 64,
    kernelSize: 3,
    activation: 'linear',
  }));
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.leakyReLU({ alpha: 0.1 }));

  model.add(tf.layers.flatten());

  model.add(tf.layers.dense({ units: 256, activation: 'linear' }));
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.leakyReLU({ alpha: 0.1 }));

  model.add(tf.layers.dense({ units: 12 })); // Output layer

  model.compile({
    optimizer,
    loss: "meanSquaredError",
    metrics: ["mse"],
  });

  // === TRAINING CONFIG ===
  let bestValLoss = Infinity;
  let epochsWithoutImprovement = 0;
  const patience = 20;
  const minEpochs = 100;

  await model.fit(xs, ys, {
    epochs: 500,
    batchSize: 64,
    shuffle: true,
    validationSplit: 0.2,
    callbacks: {
      onEpochEnd: async (epoch, logs) => {
        const valLoss = logs.val_loss;
        const currentLoss = logs.loss;

        console.log(`Epoch ${epoch + 1} | loss: ${currentLoss.toFixed(5)} | val_loss: ${valLoss.toFixed(5)}`);

        await model.save("file://./latest_model_conv1d");
        console.log("💾 Model saved.");

        if (valLoss < bestValLoss) {
          bestValLoss = valLoss;
          epochsWithoutImprovement = 0;
        } else {
          epochsWithoutImprovement++;
        }

        if (epochsWithoutImprovement > 0 && epochsWithoutImprovement % 10 === 0) {
          currentLr *= 0.5;
          model.optimizer = tf.train.adam(currentLr);
          console.log(`🔽 Learning rate reduced to ${currentLr}`);
        }

        if ((epoch + 1 >= minEpochs) && (epochsWithoutImprovement >= patience)) {
          console.log("⏹️ Early stopping: No val_loss improvement.");
          model.stopTraining = true;
        }
      },
    },
  });

  // Final save
  await model.save("file://./final_model_conv1d");
  console.log("✅ Training complete. Final model saved.");

  // Predict first few samples and compare (denormalized)
  const preds = model.predict(xs.slice([0], [5]));
  const denormPreds = preds.mul(ysStd).add(ysMean);
  denormPreds.print();
  rawYs.slice([0], [5]).print();
}

run().catch(console.error);
