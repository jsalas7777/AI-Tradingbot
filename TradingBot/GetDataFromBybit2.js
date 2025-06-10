const axios = require("axios");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const apiKey = "";
const apiSecret = "";
const test_net = false;

const {
  RestClientV5,
} = require("bybit-api");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const KLINE_INTERVAL = "5"; // 5-minute interval
const hour = (24 * 30 * 6) * 60 * 60 * 1000; // 72 hours in milliseconds
const endDate = Date.now();
const startDate = endDate - hour;

const getKlineData = async (symbol, startTimestamp, endTimestamp) => {
  try {
    const response = await axios.get("https://api.bybit.com/v5/market/kline", {
      params: {
        category: "inverse",
        symbol: symbol,
        interval: KLINE_INTERVAL,
        start: startTimestamp,
        end: endTimestamp,
      },
    });

    if (response.data.result.list.length > 0) {
      return response.data.result.list;
    }
    return [];
  } catch (error) {
    console.error("Error fetching kline data:", error);
    return [];
  }
};

const downloadData = async (symbol) => {
  console.log("DOWNLOADING ", symbol);
  let startTimestamp = startDate;
  let allData = [];

  const timeInMs = 120 * 60 * 1000; // 120 minutes * 60 seconds * 1000 ms

  while (startTimestamp < endDate) {

    console.log("Download data ",startTimestamp, startTimestamp/endDate);


    const endTimestamp = Math.min(
      startTimestamp + timeInMs,
      endDate
    );
    const klineData = await getKlineData(symbol, startTimestamp, endTimestamp);

    if (klineData.length > 0) {
      klineData.forEach((item) => {
        if (!allData.some((existingItem) => existingItem[0] === item[0])) {
          allData.push(item);
        }
      });
    }
    startTimestamp = endTimestamp;
  }

  allData.sort((a, b) => a[0] - b[0]);
  return allData;
};

const saveDataToCSV = (data, symbol) => {
  const folderPath = path.join(__dirname, "bybit_data");
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath);
  }

  const csvWriter = createCsvWriter({
    path: path.join(folderPath, `${symbol}_kline_data.csv`),
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

  csvWriter
    .writeRecords(records)
    .then(() => {
      console.log(`Data saved to bybit_data/${symbol}_kline_data.csv`);
    })
    .catch((err) => {
      console.error("Error writing CSV file:", err);
    });
};

const random = async () => {
  console.log("Random function called!");
  const bybit_client = new RestClientV5({
    key: apiKey,
    secret: apiSecret,
    testnet: test_net,
  });

  const response = await bybit_client.getTickers({ category: "linear" });
  let list = response.result.list.filter((symbol) => !symbol.symbol.includes("-") && !symbol.symbol.toLowerCase().includes("perp"));
  list = list.sort(() => Math.random() - 0.5).slice(0, 100);

  for (let item of list) {
    let data = await downloadData(item.symbol);
    await saveDataToCSV(data, item.symbol);
  }
};

const volume = async () => {


  console.log("Volume function called!");
  const bybit_client = new RestClientV5({
    key: apiKey,
    secret: apiSecret,
    testnet: test_net,
  });



  try {
    // Use 'linear' category for margin (USDT perpetual) markets
    const response = await axios.get('https://api.bybit.com/v5/market/tickers?category=linear');
    const tickers = response.data.result.list;

    // Sort by 24h turnover (volume in quote currency)
    const sorted = tickers.sort((a, b) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h));

    // Extract top 50
    const top50 = sorted.slice(0, 50).map(ticker => ({
      symbol: ticker.symbol,
      lastPrice: ticker.lastPrice,
      volume24h: ticker.volume24h,
      turnover24h: ticker.turnover24h,
      priceChangePercent24h: ticker.price24hPcnt,
    }));


    for (let item of top50) {
      let data = await downloadData(item.symbol);
      await saveDataToCSV(data, item.symbol);
    }
  


    console.log(top50);
  } catch (error) {
    console.error('Error fetching margin tickers:', error.message);
  }

 
  const list = [];

  


};

rl.question(
  'Enter the symbol to download data for (e.g., BTCUSD), or type "random" to call the random function: ',
  (input) => {
    if (input.toLowerCase() === "random") {
      random();
      rl.close();
    }else if (input.toLowerCase() === "volume") {
      volume();
      rl.close();
    }  else {
      downloadData(input)
        .then((data) => {
          saveDataToCSV(data, input);
          rl.close();
        })
        .catch((error) => {
          console.error("Error downloading data:", error);
          rl.close();
        });
    }
  }
);
