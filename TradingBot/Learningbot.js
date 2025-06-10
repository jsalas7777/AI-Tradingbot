// learningbot.js
const tf = require("@tensorflow/tfjs-node");

const axios = require("axios");
const path = require("path");
const cron = require("node-cron");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const fs = require("fs");
const fsPromises = fs.promises;
const readline = require("readline");
const { RSI } = require("technicalindicators");
const apiKey = "";
const apiSecret = "";
const test_net = false;


const {
  InverseClient,
  LinearClient,
  InverseFuturesClient,
  SpotClientV3,
  UnifiedMarginClient,
  USDCOptionClient,
  USDCPerpetualClient,
  AccountAssetClient,
  CopyTradingClient,
  RestClientV5,
} = require("bybit-api");



var SYMBOLS = [
  "BTCUSDT"
 
];
const TIMEFRAMES = ["5m", "15m", "1h"];


async function getAllUSDTFuturesSymbols() {
  const client = new RestClientV5({
    key: apiKey,
    secret: apiSecret,
    testnet: test_net,
  });

  try {
    const response = await client.getInstrumentsInfo({ category: "linear" });
    const allSymbols = response.result.list;

    const usdtSymbols = allSymbols
      .filter((s) => s.symbol.endsWith("USDT") && s.status === "Trading")
      .map((s) => s.symbol);

    console.log(`✅ Found ${usdtSymbols.length} USDT futures symbols`);
    return usdtSymbols;
  } catch (err) {
    console.error("❌ Error fetching USDT symbols:", err.message || err);
    return [];
  }
}

async function getAverageHourlyVolumeUSDT(symbol) {
  const client = new RestClientV5({
    key: apiKey,
    secret: apiSecret,
    testnet: test_net,
  });

  try {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    const response = await client.getKline({
      category: "linear",
      symbol: symbol,
      interval: "1",
      start: oneHourAgo,
      end: now,
      limit: 60,
    });

    const candles = response.result?.list || [];

    if (candles.length === 0) {
      console.warn(`⚠️ No candle data found for ${symbol}`);
      return 0;
    }

    const totalVolumeUSDT = candles.reduce((sum, c) => {
      const close = parseFloat(c[4]); // close price
      const volume = parseFloat(c[5]); // volume in base coin
      return sum + close * volume; // convert to USDT
    }, 0);

    const averagePerMinute = totalVolumeUSDT / candles.length;
    const averagePerHour = averagePerMinute * 60;

    console.log(`📊 Average hourly volume for ${symbol}: $${Math.round(averagePerHour)}`);
    return averagePerHour;
  } catch (error) {
    console.error(`❌ Error fetching volume for ${symbol}:`, error.message);
    return 0;
  }
}


// Main training process
async function trainingProcess() {
  // Shuffle SYMBOLS array in place using Fisher-Yates shuffle


  SYMBOLS = await getAllUSDTFuturesSymbols();

  for (let i = SYMBOLS.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [SYMBOLS[i], SYMBOLS[j]] = [SYMBOLS[j], SYMBOLS[i]];
  }

  SYMBOLS = SYMBOLS.slice(0, 20);

  //----------- QUERYING RANDOM SYMBOLS

  for (const symbol of SYMBOLS) {


     //--------- VOLUME -------

     const volume = await getAverageHourlyVolumeUSDT(symbol);

     if (volume < 50000){
       
         console.log("NOT ENOUGHT VOLUME TO TRADE");
         continue;
     }


    for (const timeframe of TIMEFRAMES) {
      const tag = `${symbol}_${timeframe}`;

      await downloaddatafrombybit(symbol, timeframe);
      if (!(await verifydata(symbol, timeframe))) continue;

      await normalizedata(tag);
      await generateDataset(tag, 48, 12);
      await trainModel(symbol,timeframe, 48, 12);

      const result = await model_verification(symbol,timeframe, 48, 12);
      if (!result) {
        console.error(`❌ Verification failed for ${tag}`);
        continue;
      }

      const { mae, mse } = result;
      if (mae < 1.0 && mse < 2.0) {
        console.log(
          `✅ Model for ${tag} is GOOD (MAE: ${mae.toFixed(
            4
          )}, MSE: ${mse.toFixed(4)})`
        );
      } else {
        console.warn(
          `⚠️ Model for ${tag} is WEAK (MAE: ${mae.toFixed(
            4
          )}, MSE: ${mse.toFixed(4)})`
        );
        await deletingmodel(tag);
        continue;
      }

      await cleanup(tag);
    }
  }
}

async function deletingmodel(symbol) {
  const modelPaths = [
    path.join(__dirname, "models", symbol), // Final model
    path.join(__dirname, "models", `${symbol}_latest`), // Temp model
  ];

  for (const folder of modelPaths) {
    try {
      await fsPromises.rm(folder, { recursive: true, force: true });
      console.log(`🗑️ Deleted model folder: ${folder}`);
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.warn(
          `⚠️ Could not delete model folder ${folder}: ${err.message}`
        );
      }
    }
  }
}

async function cleanup(symbol) {
  const filesToDelete = [
    path.join(__dirname, "bybit_data", `${symbol}_kline_data.csv`),
    path.join(__dirname, "sequence", `${symbol}_normalized.csv`),
    path.join(__dirname, "sequence", `${symbol}_training_dataset.csv`),
  ];

  const tempFoldersToDelete = [
    path.join(__dirname, "models", `${symbol}_latest`), // TEMP only
  ];

  for (const file of filesToDelete) {
    try {
      await fsPromises.unlink(file);
      console.log(`🧹 Deleted file: ${file}`);
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.warn(`⚠️ Could not delete file ${file}: ${err.message}`);
      }
    }
  }

  for (const folder of tempFoldersToDelete) {
    try {
      await fsPromises.rm(folder, { recursive: true, force: true });
      console.log(`🧼 Deleted temp folder: ${folder}`);
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.warn(
          `⚠️ Could not delete temp folder ${folder}: ${err.message}`
        );
      }
    }
  }
}

async function model_verification(symbol,timeframe, inputSize = 48, labelSize = 12) {
  const modelPath =  `file://./models/MULTICRYPTO_${timeframe}`;
  const csvPath = path.join(
    __dirname,
    `/sequence/${symbol}_${timeframe}_training_dataset.csv`
  );

  const { xs, rawYs, ysMean, ysStd } = await loadDataset(
    csvPath,
    inputSize,
    labelSize
  );

  try {
    const model = await tf.loadLayersModel(modelPath + "/model.json");
    const preds = model.predict(xs);

    // Denormalize predictions
    const denormPreds = preds.mul(ysStd).add(ysMean);

    // Calculate Mean Absolute Error and Mean Squared Error
    const mae = tf.metrics.meanAbsoluteError(rawYs, denormPreds);
    const mse = tf.metrics.meanSquaredError(rawYs, denormPreds);

    const maeVal = await mae.data();
    const mseVal = await mse.data();

    console.log(`📊 Model verification for ${symbol}`);
    console.log(`✅ MAE: ${maeVal[0].toFixed(4)}`);
    console.log(`✅ MSE: ${mseVal[0].toFixed(4)}`);

    return {
      mae: maeVal[0],
      mse: mseVal[0],
    };
  } catch (err) {
    console.error(`❌ Failed to verify model for ${symbol}:`, err.message);
    return null;
  }
}

// Download data with progress
// Download data with progress
async function downloaddatafrombybit(symbol, timeframe) {
  const INTERVAL = timeframe.replace("m", ""); // e.g., "5m" → "5", "1h" → "60"
  const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  const STEP_MS = 120 * 60 * 1000; // 2 hours
  const endDate = Date.now();
  const startDate = endDate - LOOKBACK_MS;

  const totalSteps = Math.ceil((endDate - startDate) / STEP_MS);

  const getKlines = async (start, end) => {
    try {
      const res = await axios.get("https://api.bybit.com/v5/market/kline", {
        params: {
          category: "linear",
          symbol,
          interval: INTERVAL === "1h" ? "60" : INTERVAL,
          start,
          end,
        },
      });
      return res.data?.result?.list || [];
    } catch (err) {
      console.error(
        `❌ ${symbol} (${timeframe}) download failed at chunk:`,
        err.message
      );
      return [];
    }
  };

  const saveToCSV = async (data) => {
    const folder = path.join(__dirname, "bybit_data");
    if (!fs.existsSync(folder)) fs.mkdirSync(folder);

    const filename = `${symbol}_${timeframe}_kline_data.csv`;

    const writer = createCsvWriter({
      path: path.join(folder, filename),
      header: [
        { id: "timestamp", title: "Timestamp" },
        { id: "open", title: "Open Price" },
        { id: "high", title: "High Price" },
        { id: "low", title: "Low Price" },
        { id: "close", title: "Close Price" },
        { id: "volume", title: "Volume" },
        { id: "turnover", title: "Turnover" },
      ],
    });

    const records = data.map((item) => ({
      timestamp: item[0],
      open: item[1],
      high: item[2],
      low: item[3],
      close: item[4],
      volume: item[5],
      turnover: item[6],
    }));

    await writer.writeRecords(records);
    console.log(`✅ ${symbol} (${timeframe}) data saved to CSV.`);
  };

  console.log(`⬇️ Downloading ${symbol} ${timeframe} (last 30 days)...`);
  let allData = [];
  let current = startDate;
  let step = 1;

  while (current < endDate) {
    const chunkEnd = Math.min(current + STEP_MS, endDate);
    const chunk = await getKlines(current, chunkEnd);

    chunk.forEach((item) => {
      if (!allData.some((existing) => existing[0] === item[0])) {
        allData.push(item);
      }
    });

    const progress = ((step / totalSteps) * 100).toFixed(1);
    const date = new Date(current).toISOString();
    console.log(
      `📦 [${symbol} ${timeframe}] Chunk ${step}/${totalSteps} (${progress}%) - ${date}`
    );

    step++;
    current = chunkEnd;
  }

  allData.sort((a, b) => a[0] - b[0]);
  await saveToCSV(allData);
}

// Placeholder stages
async function verifydata(symbol, timeframe) {
  const tag = `${symbol}_${timeframe}`;
  const filePath = path.join(__dirname, "bybit_data", `${tag}_kline_data.csv`);

  const intervalMsMap = {
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
  };

  const expectedInterval = intervalMsMap[timeframe];
  if (!expectedInterval) {
    console.error(`❌ Unknown timeframe: ${timeframe}`);
    return false;
  }

  try {
    const raw = await fsPromises.readFile(filePath, "utf-8");
    const data = raw.split("\n").slice(1); // Skip header

    let prevTimestamp = null;

    for (let i = 0; i < data.length; i++) {
      if (!data[i].trim()) continue; // Skip empty lines

      const [timestampStr] = data[i].split(",");
      const timestamp = parseInt(timestampStr, 10);

      if (isNaN(timestamp)) {
        console.error(
          `❌ ${tag} verification failed: Invalid timestamp at line ${i + 2}`
        );
        return false;
      }

      if (prevTimestamp !== null) {
        const diff = timestamp - prevTimestamp;
        if (diff !== expectedInterval) {
          console.error(
            `❌ ${tag} verification failed: Gap or disorder at line ${
              i + 2
            }. Expected ${expectedInterval} ms, got ${diff} ms.`
          );
          return false;
        }
      }

      prevTimestamp = timestamp;
    }

    console.log(`✅ ${tag} CSV data verified: sorted and gap-free.`);
    return true;
  } catch (err) {
    console.error(`❌ ${tag} verification failed:`, err.message);
    return false;
  }
}

async function generateDataset(symbol, inputSize, labelSize) {
  const inputFilePath = path.join(
    __dirname,
    `/sequence/${symbol}_normalized.csv`
  );
  const outputFilePath = path.join(
    __dirname,
    `/sequence/${symbol}_training_dataset.csv`
  );

  try {
    await fsPromises.access(inputFilePath);
  } catch {
    console.error(`❌ Input file does not exist: ${inputFilePath}`);
    return;
  }

  const rawData = await fsPromises.readFile(inputFilePath, "utf8");
  const lines = rawData.trim().split("\n").slice(1);

  const values = lines.map((line) => parseFloat(line.split(",")[1]));

  const featureHeaders = Array.from(
    { length: inputSize },
    (_, i) => `feature_${i + 1}`
  );
  const labelHeaders = Array.from(
    { length: labelSize },
    (_, i) => `label_${i + 1}`
  );
  const headers = [...featureHeaders, ...labelHeaders].join(",");

  const rows = [headers];

  for (let i = 0; i <= values.length - (inputSize + labelSize); i++) {
    const features = values.slice(i, i + inputSize);
    const labels = values.slice(i + inputSize, i + inputSize + labelSize);
    rows.push([...features, ...labels].join(","));
  }

  await fsPromises.writeFile(outputFilePath, rows.join("\n"));
  console.log(`✅ Dataset created for ${symbol}: ${outputFilePath}`);
}


async function normalizedata(symbol) {
  const inputPath = path.join(__dirname, `bybit_data/${symbol}_kline_data.csv`);
  const outputDir = path.join(__dirname, "sequence");
  const outputPath = path.join(outputDir, `${symbol}_normalized.csv`);

  try {
    await fs.promises.mkdir(outputDir, { recursive: true });

    const closePrices = [];
    const timestamps = [];

    const rl = readline.createInterface({
      input: fs.createReadStream(inputPath),
      crlfDelay: Infinity,
    });

    let isFirstLine = true;

    for await (const line of rl) {
      if (isFirstLine) {
        isFirstLine = false;
        continue;
      }

      const parts = line.split(",");
      const timestamp = parts[0];
      const close = parseFloat(parts[4]);

      if (!isNaN(close)) {
        closePrices.push(close);
        timestamps.push(timestamp);
      }
    }

    const rsi = RSI.calculate({ values: closePrices, period: 14 });

    const output = fs.createWriteStream(outputPath);
    output.write("timestamp,normalized_rsi\n");

    // Match RSI values with correct timestamps
    for (let i = 0; i < rsi.length; i++) {
      const ts = timestamps[i + 14]; // offset for RSI warmup period
      const normalized = (rsi[i] / 100).toFixed(4);
      output.write(`${ts},${normalized}\n`);
    }

    await new Promise((resolve, reject) => {
      output.end(resolve);
      output.on("error", reject);
    });

    console.log(`✅ Calculated & normalized RSI CSV for ${symbol} saved to ${outputPath}`);
  } catch (err) {
    console.error(`❌ Failed to calculate RSI for ${symbol}:`, err.message);
  }
}



async function loadDataset(csvPath, inputSize, labelSize) {
  const raw = await fs.promises.readFile(csvPath, "utf8");
  const lines = raw.trim().split("\n").slice(1); // Skip header

  const inputs = [];
  const labels = [];

  for (const line of lines) {
    const values = line.split(",").map(parseFloat);
    if (values.length !== inputSize + labelSize) continue;

    inputs.push(values.slice(0, inputSize));
    labels.push(values.slice(inputSize, inputSize + labelSize));
  }

  const xsRaw = tf.tensor2d(inputs); // [batch, inputSize]
  const ysRaw = tf.tensor2d(labels); // [batch, labelSize]

  const { mean, variance } = tf.moments(ysRaw, 0);
  const std = tf.sqrt(variance);

  const ys = ysRaw.sub(mean).div(std);

  return {
    xs: xsRaw.reshape([xsRaw.shape[0], inputSize, 1]),
    ys,
    rawYs: ysRaw,
    ysMean: mean,
    ysStd: std,
  };
}

async function trainModel(
  symbol,
  timeframe,
  inputSize = 144,
  labelSize = 12,
  targetValLoss = 0.01
) {
  const csvPath = path.join(
    __dirname,
    `/sequence/${symbol}_${timeframe}_training_dataset.csv`
  );
  const savePath = `file://./models/MULTICRYPTO_${timeframe}`;
  const modelJsonPath = path.join(__dirname, `./models/MULTICRYPTO/model.json`);

  const { xs, ys, rawYs, ysMean, ysStd } = await loadDataset(
    csvPath,
    inputSize,
    labelSize
  );

  let model;
  let bestValLoss = Infinity;
  const optimizer = tf.train.adam(0.001);

  // Attempt to load existing final model
  if (fs.existsSync(modelJsonPath)) {
    try {
      model = await tf.loadLayersModel(`${savePath}/model.json`);
      console.log("📦 Loaded final saved model.");
      model.compile({
        optimizer,
        loss: "meanSquaredError",
        metrics: ["mse"],
      });
    } catch (err) {
      console.error(
        "⚠️ Failed to load final model. Falling back to new model creation.",
        err
      );
    }
  }

  // If no model or failed to load, create a new one
  if (!model) {
    model = tf.sequential();
    model.add(
      tf.layers.conv1d({
        inputShape: [inputSize, 1],
        filters: 128,
        kernelSize: 5,
        activation: "linear",
      })
    );
    model.add(tf.layers.batchNormalization());
    model.add(tf.layers.leakyReLU({ alpha: 0.1 }));

    model.add(
      tf.layers.conv1d({
        filters: 64,
        kernelSize: 3,
        activation: "linear",
      })
    );
    model.add(tf.layers.batchNormalization());
    model.add(tf.layers.leakyReLU({ alpha: 0.1 }));

    model.add(tf.layers.flatten());

    model.add(tf.layers.dense({ units: 256, activation: "linear" }));
    model.add(tf.layers.batchNormalization());
    model.add(tf.layers.leakyReLU({ alpha: 0.1 }));

    model.add(tf.layers.dense({ units: labelSize, activation: 'sigmoid' })); // 🆕 add sigmoid activation

    model.compile({
      optimizer,
      loss: "meanSquaredError",
      metrics: ["mse"],
    });

    console.log("🆕 Created a new model.");
  }

  const minEpochs = 40;
  const maxEpochs = 80;

  await model.fit(xs, ys, {
    epochs: maxEpochs,
    batchSize: 64,
    shuffle: true,
    validationSplit: 0.2,
    callbacks: {
      onEpochEnd: async (epoch, logs) => {
        const valLoss = logs.val_loss;
        const currentLoss = logs.loss;

        console.log(
          `Epoch ${epoch + 1} | loss: ${currentLoss.toFixed(
            5
          )} | val_loss: ${valLoss.toFixed(5)}`
        );

        if (valLoss < bestValLoss) {
          bestValLoss = valLoss;
        }

        if (valLoss <= targetValLoss && epoch + 1 >= minEpochs) {
          console.log(
            `✅ Early stopping triggered. val_loss: ${valLoss.toFixed(5)}.`
          );
          model.stopTraining = true;
        }
      },
    },
  });

  await model.save(savePath);
  console.log(`✅ Training complete. Final model saved to "${savePath}"`);

  const preds = model.predict(xs.slice([0], [5]));
  const denormPreds = preds.mul(ysStd).add(ysMean);
  denormPreds.print();
  rawYs.slice([0], [5]).print();
}

// Run immediately on script launch
(async () => {
  console.log(
    `[${new Date().toISOString()}] 🚀 Initial training process started`
  );
  await trainingProcess();
})();

// Schedule every 6 hours: at 00:00, 06:00, 12:00, and 18:00
cron.schedule("0 */6 * * *", async () => {
  console.log(`[${new Date().toISOString()}] ⏰ Scheduled training process (every 6 hours)`);
   await trainingProcess();
});
