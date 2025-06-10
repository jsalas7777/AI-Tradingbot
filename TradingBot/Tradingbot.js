//enki3333
const TRADING_BOT_NAME = "enki";
const { MACD, EMA, RSI } = require("technicalindicators");

const apiKey = "";
const apiSecret = "";
const test_net = false;
const tf = require("@tensorflow/tfjs-node");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");

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

var SYMBOLS_TO_TRADE = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "DOGEUSDT",
  "FARTCOINUSDT",
  "XRPUSDT",
  "ANIMEUSDT",
  "SUIUSDT",
  "1000PEPEUSDT",
  "WIFUSDT",
];

const MINIMUM_TRADING_VOLUME = 0;

const MINIMUM_AIS_TO_TRADE = 2;
const MAX_ORDERS_PER_SESSION = 20;

const TAKE_PROFIT_PRICE_PERCENTAGE_MOMENTUM = 1.5; //change
const STOP_LOSS_PRICE_PERCENTAGE_MOMENTUM = 50;

const MINUTES_TO_CLOSE = 5; //this closes orders

const CLOSING_PROFIT_MARKET = 10;
const CLOSING_LOSS_MARKET = -10;

const LEVERAGE = 50;

const MAX_POSITIONS = 100;

const MINIMUM_ORDER_QTY = 10; //await minimumOrderQuantity(symbol);

const express = require("express");
const ScanItem = require("./database/ScanItem");
const { connectionMongoose } = require("./components/Database");

// Define a port

var purhcase_orders = [];

var TRADING_DIRECTION = "NONE";

const AI_VERSION = "TRUMPUSDT V3";

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

async function scanItems() {
  const bybit_client = new RestClientV5({
    key: apiKey,
    secret: apiSecret,
    testnet: test_net,
  });

  SYMBOLS_TO_TRADE = await getAllUSDTFuturesSymbols();

  for (let symbol of SYMBOLS_TO_TRADE) {
    const symbolName = symbol;

    const TRADING_UNIT = 50; //USDT

    const positionDirection = await getPositionDirection(symbolName);
    const margin_wallet = await getMarginBalance();
    const margin_balance = margin_wallet.equity;

    //--------- VOLUME -------

    const volume = await getAverageHourlyVolumeUSDT(symbol);

    if (volume < 50000) {
      console.log("NOT ENOUGHT VOLUME TO TRADE");
      continue;
    }

    //--------------------------------------------

    let prediction_5m = null;
    let prediction_15m = null;
    let prediction_1h = null;

    const result5m = await evaluateLivePrediction(symbolName, "5m");
    const result15m = await evaluateLivePrediction(symbolName, "15m");
    const result1h = await evaluateLivePrediction(symbolName, "1h");

    // Only access .slice if the result exists and is correctly structured
    if (Array.isArray(result5m) && Array.isArray(result5m[0])) {
      prediction_5m = result5m[0].slice(0, 12);
    }

    if (Array.isArray(result15m) && Array.isArray(result15m[0])) {
      prediction_15m = result15m[0].slice(0, 12);
    }

    if (Array.isArray(result1h) && Array.isArray(result1h[0])) {
      prediction_1h = result1h[0].slice(0, 12);
    }

    //----------CUT ARRAYS BY 6

    console.log("PREDICTION 5M ", prediction_5m);
    console.log("PREDICTION 15M ", prediction_15m);
    console.log("PREDICTION 1h ", prediction_1h);

    // ✅ Validate all predictions
    if (
      !Array.isArray(prediction_5m) ||
      prediction_5m.length === 0 ||
      !Array.isArray(prediction_15m) ||
      prediction_15m.length === 0 ||
      !Array.isArray(prediction_1h) ||
      prediction_1h.length === 0
    ) {
      console.warn(
        `⚠️ Skipping ${symbolName}: One or more predictions are invalid.`
      );
      continue;
    }

    // ---------- CONTINUE YOUR LOGIC BELOW AS BEFORE ----------

    const summary5m = isBullOrBear(prediction_5m); // returns "bull", "bear", or "neutral"
    const summary15m = isBullOrBear(prediction_15m);
    const summary1h = isBullOrBear(prediction_1h);

    await createOrder(
      symbolName,
      "AI PREDICTION",
      0,
      " MARGIN BALANCE " +
        margin_balance +
        " POSITION DIRECTION " +
        positionDirection +
        " TREND 5M " +
        summary5m +
        " TREND 15M " +
        summary15m +
        " TREND 1h " +
        summary1h
    );

    const bullCount = [summary5m, summary15m, summary1h].filter(
      (s) => s === "bull"
    ).length;
    const bearCount = [summary5m, summary15m, summary1h].filter(
      (s) => s === "bear"
    ).length;

    const isBullish = bullCount >= 2;
    const isBearish = bearCount >= 2;

    console.log("SUMMARY SYMBOL", symbol, summary5m, summary15m, summary1h);

    const atr_entry = await calculateAtrStopLossPercent(symbolName, 5, 1.5); // timeframe = 5m, multiplier = 1.5

    //-------------- ADX ------------

    const candlesForAdx = await downloadCandles(symbolName, bybit_client, 5); // 5m timeframe
    const adxValue = getAdx(candlesForAdx, 14); // default period 14
    if (adxValue < 30) {
      console.log(
        `⚠️ Skipping ${symbolName} due to weak trend (ADX=${adxValue.toFixed(
          2
        )})`
      );
    }

    //--------------- ADX ------------

    // ------------------- EMA CROSSOVER LOGIC ------------------- //
    const closes = candlesForAdx.map((c) => parseFloat(c[4]));
    const ema12 = EMA.calculate({ period: 12, values: closes });
    const ema144 = EMA.calculate({ period: 144, values: closes });

    if (ema12.length < 2 || ema144.length < 2) {
      console.log(`⚠️ Not enough EMA data for ${symbolName}`);
      continue;
    }

    const prevDiff = ema12[ema12.length - 2] - ema144[ema144.length - 2];
    const currDiff = ema12[ema12.length - 1] - ema144[ema144.length - 1];

    if (prevDiff < 0 && currDiff > 0) {
      // ✅ Upward crossover → BUY
      if (positionDirection === "SHORT") {
        await closePosition(symbolName);
      }

      await placeLimitOrderByPercentage(
        symbolName,
        "Buy",
        atr_entry,
        TRADING_UNIT,
        Math.abs(atr_entry * 10),
        Math.abs(atr_entry * 10)
      );

      await createOrder(symbolName, "EMA CROSSOVER", 0, "BUY");
    }

    if (prevDiff > 0 && currDiff < 0) {
      // ✅ Downward crossover → SELL
      if (positionDirection === "LONG") {
        await closePosition(symbolName);
      }

      await placeLimitOrderByPercentage(
        symbolName,
        "Sell",
        atr_entry,
        TRADING_UNIT,
        Math.abs(atr_entry * 10),
        Math.abs(atr_entry * 10)
      );

      await createOrder(symbolName, "EMA CROSSOVER", 0, "SELL");
    }
    // ------------------- END EMA CROSSOVER LOGIC ------------------- //

    // ✅ BULLISH
    if (isBullish) {
      if (positionDirection === "LONG") continue;
      if (positionDirection === "SHORT") {
        closePosition(symbol);
      }

      await createOrder(symbolName, "AI PREDICTION", 0, `BUY`);
    }

    // ✅ BEARISH
    if (isBearish) {
      if (positionDirection === "LONG") {
        closePosition(symbol);
      }

      await createOrder(symbolName, "AI PREDICTION", 0, `SELL`);
    }

    //--------------------------------------
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

    console.log(
      `📊 Average hourly volume for ${symbol}: $${Math.round(averagePerHour)}`
    );
    return averagePerHour;
  } catch (error) {
    console.error(`❌ Error fetching volume for ${symbol}:`, error.message);
    return 0;
  }
}

async function calculateAtrStopLossPercent(
  symbol,
  timeframe = 5,
  atrMultiplier = 1.5
) {
  const client = new RestClientV5({
    key: apiKey,
    secret: apiSecret,
    testnet: test_net,
  });

  const candles = await downloadCandles(symbol, client, timeframe);
  if (!candles || candles.length < 15) {
    console.warn(`⚠️ Not enough candles for ATR stop loss on ${symbol}`);
    return null;
  }

  const highs = candles.map((c) => parseFloat(c[2]));
  const lows = candles.map((c) => parseFloat(c[3]));
  const closes = candles.map((c) => parseFloat(c[4]));

  const atrInput = {
    high: highs,
    low: lows,
    close: closes,
    period: 14,
  };

  const atrValues = require("technicalindicators").ATR.calculate(atrInput);

  if (!atrValues || atrValues.length === 0) {
    console.error(`❌ ATR calculation failed for ${symbol}`);
    return null;
  }

  const latestATR = atrValues[atrValues.length - 1];
  const lastClose = closes[closes.length - 1];

  const atrStopLossDistance = atrMultiplier * latestATR;
  const atrStopLossPercent = (atrStopLossDistance / lastClose) * 100;

  console.log(`📏 ATR SL % for ${symbol}: ${atrStopLossPercent.toFixed(2)}%`);
  return atrStopLossPercent;
}

function isBullOrBear(normalizedRSI) {
  if (!Array.isArray(normalizedRSI) || normalizedRSI.length < 3) {
    return "neutral";
  }

  let up = 0;
  let down = 0;

  for (let i = 1; i < normalizedRSI.length; i++) {
    if (normalizedRSI[i] > normalizedRSI[i - 1]) up++;
    else if (normalizedRSI[i] < normalizedRSI[i - 1]) down++;
  }

  const trendStrength = (up - down) / (normalizedRSI.length - 1);

  if (trendStrength > 0.3) return "bull";
  if (trendStrength < -0.3) return "bear";

  return "neutral";
}

function getAdxTrendDirection(candles, period = 14) {
  const adxValues = [];

  try {
    // Use your existing ADX function to compute the whole ADX series
    const trList = [];
    const plusDM = [];
    const minusDM = [];

    for (let i = 1; i < candles.length; i++) {
      const current = candles[i];
      const previous = candles[i - 1];

      const high = parseFloat(current[2]);
      const low = parseFloat(current[3]);
      const close = parseFloat(current[4]);

      const prevHigh = parseFloat(previous[2]);
      const prevLow = parseFloat(previous[3]);
      const prevClose = parseFloat(previous[4]);

      const upMove = high - prevHigh;
      const downMove = prevLow - low;

      plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trList.push(tr);
    }

    const smoothedTR = [];
    const smoothedPlusDM = [];
    const smoothedMinusDM = [];

    smoothedTR[0] = trList.slice(0, period).reduce((a, b) => a + b, 0);
    smoothedPlusDM[0] = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
    smoothedMinusDM[0] = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

    for (let i = period; i < trList.length; i++) {
      smoothedTR.push(
        smoothedTR.at(-1) - smoothedTR.at(-1) / period + trList[i]
      );
      smoothedPlusDM.push(
        smoothedPlusDM.at(-1) - smoothedPlusDM.at(-1) / period + plusDM[i]
      );
      smoothedMinusDM.push(
        smoothedMinusDM.at(-1) - smoothedMinusDM.at(-1) / period + minusDM[i]
      );
    }

    const plusDI = smoothedPlusDM.map((val, i) => 100 * (val / smoothedTR[i]));
    const minusDI = smoothedMinusDM.map(
      (val, i) => 100 * (val / smoothedTR[i])
    );

    const dx = plusDI.map((pdi, i) => {
      const mdi = minusDI[i];
      return (Math.abs(pdi - mdi) / (pdi + mdi)) * 100;
    });

    const adx = [];
    adx[0] = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < dx.length; i++) {
      adx.push((adx.at(-1) * (period - 1) + dx[i]) / period);
    }

    const last = adx.at(-1);
    const prev = adx.at(-2);

    const diff = last - prev;

    if (Math.abs(diff) < 0.5) return "flat";
    if (diff > 0) return "rising";
    return "falling";
  } catch (err) {
    console.error("❌ Error in getAdxTrendDirection:", err.message || err);
    return "error";
  }
}

function calculateVolatilityComparison(candles, window = 12) {
  if (candles.length < window + 2) return null;

  const getTrueRange = (current, prevClose) => {
    const high = parseFloat(current[2]);
    const low = parseFloat(current[3]);
    return Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
  };

  const trAll = [];
  for (let i = 1; i < candles.length - window; i++) {
    const tr = getTrueRange(candles[i], parseFloat(candles[i - 1][4]));
    trAll.push(tr);
  }

  const trRecent = [];
  for (let i = candles.length - window + 1; i < candles.length; i++) {
    const tr = getTrueRange(candles[i], parseFloat(candles[i - 1][4]));
    trRecent.push(tr);
  }

  const avgVolatility =
    trAll.reduce((a, b) => a + b, 0) / trAll.length || 0.0001;
  const recentVolatility =
    trRecent.reduce((a, b) => a + b, 0) / trRecent.length || 0.0001;

  const comparison = recentVolatility / avgVolatility;

  return {
    avgVolatility: parseFloat(avgVolatility.toFixed(4)),
    recentVolatility: parseFloat(recentVolatility.toFixed(4)),
    comparisonRatio: parseFloat(comparison.toFixed(2)),
  };
}

async function placeMarketOrderByUsdt(
  symbol,
  operation, // "Buy" or "Sell"
  usdtAmount,
  takeProfitPercentage = 1.5,
  stopLossPercentage = 1.0
) {
  const client = new RestClientV5({
    key: apiKey,
    secret: apiSecret,
    testnet: test_net,
  });

  try {
    // Get current price
    const time = Date.now();
    const kline = await client.getKline({
      category: "linear",
      symbol,
      interval: 1,
      start: time - 60 * 1000,
      end: time,
      limit: 1,
    });

    const currentPrice = parseFloat(kline.result.list[0][4]);
    if (isNaN(currentPrice)) throw new Error("Invalid current price");

    // Get instrument info
    const info = (
      await client.getInstrumentsInfo({ category: "linear", symbol })
    ).result.list[0];
    const qtyStep = info.lotSizeFilter.qtyStep;
    const tickSize = info.priceFilter.tickSize;

    const priceDecimals = tickSize.includes(".")
      ? tickSize.split(".")[1].length
      : 0;
    const qtyDecimals = qtyStep.includes(".")
      ? qtyStep.split(".")[1].length
      : 0;

    // Calculate quantity
    let qty = usdtAmount / currentPrice;
    qty = Math.floor(qty / parseFloat(qtyStep)) * parseFloat(qtyStep);
    qty = parseFloat(qty.toFixed(qtyDecimals));

    if (qty <= 0) throw new Error("Invalid quantity calculated");

    // Calculate TP/SL
    const takeProfit =
      operation === "Buy"
        ? currentPrice * (1 + takeProfitPercentage / 100)
        : currentPrice * (1 - takeProfitPercentage / 100);
    const stopLoss =
      operation === "Buy"
        ? currentPrice * (1 - stopLossPercentage / 100)
        : currentPrice * (1 + stopLossPercentage / 100);

    const formattedTP = parseFloat(takeProfit.toFixed(priceDecimals));
    const formattedSL = parseFloat(stopLoss.toFixed(priceDecimals));

    // Submit market order
    const order = await client.submitOrder({
      category: "linear",
      symbol,
      side: operation,
      orderType: "Market",
      qty: qty.toString(),
      reduceOnly: false,
      takeProfit: formattedTP.toString(),
      stopLoss: formattedSL.toString(),
      tpTriggerBy: "MarkPrice",
      slTriggerBy: "MarkPrice",
      marketUnit: "baseCoin",
    });

    if (order.retCode !== 0) {
      console.error(`❌ Order failed: [${order.retCode}] ${order.retMsg}`);
      return { success: false, reason: order.retMsg, code: order.retCode };
    }

    console.log(
      `📌 ${operation} MARKET order placed for ${symbol} at ~${currentPrice}`
    );
    return { success: true, order };
  } catch (err) {
    console.error(`❌ Order error: ${err.message || err}`);
    return { success: false, reason: err.message || "Unknown error" };
  }
}

async function closeOldPositions(symbol, maxAgeMs = 60 * 60 * 1000) {
  const client = new RestClientV5({
    key: apiKey,
    secret: apiSecret,
    testnet: test_net,
  });

  console.log("CLOSE OLD POSITIONS");

  try {
    const result = await client.getPositionInfo({
      symbol: symbol,
      category: "linear",
    });
    const positions = result.result?.list || [];

    if (positions.length === 0) {
      console.log("📭 No open positions found.");
      return;
    }

    for (const position of positions) {
      console.log("POSITION ", position);

      const symbol = position.symbol;
      const size = parseFloat(position.size);
      if (size === 0 || !["Buy", "Sell"].includes(position.side)) continue;

      const openTime = parseInt(position.updatedTime); // <- FIXED HERE
      if (!openTime || isNaN(openTime)) continue;

      const age = Date.now() - openTime;

      console.log("POSITION AGE ", age, "MAX AGE ", maxAgeMs);

      if (age > maxAgeMs) {
        console.log(
          `🕒 Closing position on ${symbol} (open for ${Math.round(
            age / 1000
          )}s)`
        );

        const side = position.side.toLowerCase();
        const closeSide = side === "buy" ? "Sell" : "Buy";

        try {
          await client.submitOrder({
            category: "linear",
            symbol,
            side: closeSide,
            orderType: "Market",
            qty: position.size,
            reduceOnly: true,
          });
          console.log(`✅ Closed old position on ${symbol}`);
        } catch (err) {
          console.error(
            `❌ Failed to close position on ${symbol}:`,
            err.message || err
          );
        }
      }
    }
  } catch (error) {
    console.error("❌ Error closing old positions:", error.message || error);
  }
}

async function getHighLowCenter(symbol, timeframe = 5) {
  const client = new RestClientV5({
    key: apiKey,
    secret: apiSecret,
    testnet: test_net,
  });

  const candles = await downloadCandles(symbolName, client, timeframe);
  if (!candles || candles.length < 12) {
    console.error("❌ Not enough candles to evaluate high/low/center.");
    return null;
  }

  const last12 = candles.slice(-12);

  const highs = last12.map((c) => parseFloat(c[2]));
  const lows = last12.map((c) => parseFloat(c[3]));

  const highest = Math.max(...highs);
  const lowest = Math.min(...lows);
  const center = (highest + lowest) / 2;

  console.log(`📊 High: ${highest}, Low: ${lowest}, Center: ${center}`);
  return { highest, lowest, center };
}
function getAverageRangeBoundPercentage(candles) {
  const chunkSize = 12;
  const rangeBoundPercentages = [];

  for (let i = 0; i <= candles.length - chunkSize; i++) {
    const chunk = candles.slice(i, i + chunkSize);

    const highs = chunk.map((c) => parseFloat(c[2]));
    const lows = chunk.map((c) => parseFloat(c[3]));

    const highest = Math.max(...highs);
    const lowest = Math.min(...lows);

    if (lowest === 0) continue; // Avoid divide-by-zero

    const rangeBoundPercentage = ((highest - lowest) / lowest) * 100;
    rangeBoundPercentages.push(rangeBoundPercentage);
  }

  if (rangeBoundPercentages.length === 0) return null;

  const average =
    rangeBoundPercentages.reduce((sum, p) => sum + p, 0) /
    rangeBoundPercentages.length;

  return average;
}

async function cancelAllOpenOrdersBySymbol(symbol) {
  const client = new RestClientV5({
    key: apiKey,
    secret: apiSecret,
    testnet: test_net,
  });

  try {
    // Fetch all open orders
    const openOrders = await client.getActiveOrders({
      category: "linear",
      symbol: symbol,
    });

    // Loop through and cancel only non-TP/SL orders
    for (const order of openOrders.result.list) {
      const { orderId, stopOrderType } = order;

      // Skip take profit and stop loss orders
      if (stopOrderType === "TakeProfit" || stopOrderType === "StopLoss")
        continue;

      await client.cancelOrder({
        category: "linear",
        symbol: symbol,
        orderId: orderId,
      });

      console.log(`🗑️ Canceled order ${orderId} for ${symbol}`);
    }

    console.log(`✅ Selectively canceled non-TP/SL orders for ${symbol}.`);
  } catch (error) {
    console.error(
      `❌ Failed to cancel selective orders for ${symbol}:`,
      error.message || error
    );
  }
}

async function placeLimitOrderByPercentage(
  symbol,
  operation,
  percentageOffset,
  usdtAmount,
  takeProfitPercentage = 1.5,
  stopLossPercentage = 1.0
) {
  const client = new RestClientV5({
    key: apiKey,
    secret: apiSecret,
    testnet: test_net,
  });

  try {
    // Get current price
    const time = Date.now();
    const kline = await client.getKline({
      category: "linear",
      symbol,
      interval: 1,
      start: time - 60 * 1000,
      end: time,
      limit: 1,
    });

    const currentPrice = parseFloat(kline.result.list[0][4]);
    if (isNaN(currentPrice)) throw new Error("Invalid current price");

    // Get instrument info
    const info = (
      await client.getInstrumentsInfo({ category: "linear", symbol })
    ).result.list[0];
    const qtyStep = info.lotSizeFilter.qtyStep;
    const tickSize = info.priceFilter.tickSize;

    const priceDecimals = tickSize.includes(".")
      ? tickSize.split(".")[1].length
      : 0;
    const qtyDecimals = qtyStep.includes(".")
      ? qtyStep.split(".")[1].length
      : 0;

    // Calculate entry price
    let limitPrice =
      operation === "Buy"
        ? currentPrice * (1 - percentageOffset / 100)
        : currentPrice * (1 + percentageOffset / 100);
    limitPrice = parseFloat(limitPrice.toFixed(priceDecimals));

    // Calculate TP/SL
    const takeProfit =
      operation === "Buy"
        ? limitPrice * (1 + takeProfitPercentage / 100)
        : limitPrice * (1 - takeProfitPercentage / 100);
    const stopLoss =
      operation === "Buy"
        ? limitPrice * (1 - stopLossPercentage / 100)
        : limitPrice * (1 + stopLossPercentage / 100);

    const formattedTP = parseFloat(takeProfit.toFixed(priceDecimals));
    const formattedSL = parseFloat(stopLoss.toFixed(priceDecimals));

    // Validate SL
    if (operation === "Buy" && formattedSL >= limitPrice) {
      console.error(
        `❌ Invalid SL: Buy stop loss (${formattedSL}) >= limit (${limitPrice})`
      );
      return { success: false, reason: "Invalid SL for Buy" };
    }
    if (operation === "Sell" && formattedSL <= limitPrice) {
      console.error(
        `❌ Invalid SL: Sell stop loss (${formattedSL}) <= limit (${limitPrice})`
      );
      return { success: false, reason: "Invalid SL for Sell" };
    }

    // Calculate quantity
    let qty = usdtAmount / limitPrice;
    qty = Math.floor(qty / parseFloat(qtyStep)) * parseFloat(qtyStep);
    qty = parseFloat(qty.toFixed(qtyDecimals));

    // Submit limit order
    const order = await client.submitOrder({
      category: "linear",
      symbol,
      side: operation,
      orderType: "Limit",
      price: limitPrice.toString(),
      qty: qty.toString(),
      timeInForce: "GTC",
      isPostOnly: true,
      takeProfit: formattedTP.toString(),
      stopLoss: formattedSL.toString(),
      tpTriggerBy: "MarkPrice",
      slTriggerBy: "MarkPrice",
      marketUnit: "baseCoin",
    });

    if (order.retCode !== 0) {
      console.error(`❌ Order failed: [${order.retCode}] ${order.retMsg}`);
      return { success: false, reason: order.retMsg, code: order.retCode };
    }

    console.log(
      `📌 ${operation} LIMIT order placed for ${symbol} at ${limitPrice}`
    );
    return { success: true, order };
  } catch (err) {
    console.error(`❌ Order error: ${err.message || err}`);
    return { success: false, reason: err.message || "Unknown error" };
  }
}

async function closePosition(symbol) {
  const client = new RestClientV5({
    key: apiKey,
    secret: apiSecret,
    testnet: test_net,
  });

  try {
    const result = await client.getPositionInfo({ category: "linear", symbol });
    const positions = result.result?.list;

    if (!positions || positions.length === 0) return;

    const position = positions.find((p) => parseFloat(p.size) !== 0);
    if (!position) return;

    const closeSide = position.side === "Buy" ? "Sell" : "Buy";

    await client.submitOrder({
      category: "linear",
      symbol,
      side: closeSide,
      orderType: "Market",
      qty: position.size,
      reduceOnly: true,
      marketUnit: "baseCoin",
    });

    console.log(`✅ Closed ${closeSide} position on ${symbol}`);
  } catch (error) {
    console.error("Error closing position:", error.message);
  }
}

async function evaluateLivePrediction(symbolName, timeframe, inputSize = 48) {
  console.log("EVALUATE LIVE PREDICTIONS ", symbolName, timeframe);

  const timeframeMap = {
    "1m": 1,
    "3m": 3,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "2h": 120,
    "4h": 240,
    "1d": "D",
  };

  if (!timeframeMap[timeframe]) {
    console.error(
      `❌ Invalid timeframe: "${timeframe}". Supported: ${Object.keys(
        timeframeMap
      ).join(", ")}`
    );
    return;
  }

  const mappedTimeframe = timeframeMap[timeframe];

  const bybit_client = new RestClientV5({
    key: apiKey,
    secret: apiSecret,
    testnet: test_net,
  });

  const candles = await downloadCandles(
    symbolName,
    bybit_client,
    mappedTimeframe
  );

  console.log("Download Candles ", candles.length);

  if (candles.length < inputSize + 14) {
    // RSI needs 14 periods
    console.error(
      `❌ Not enough candle data for ${symbolName} (${timeframe}). Need at least ${
        inputSize + 14
      }.`
    );
    return;
  }

  const lastCandle = candles[candles.length - 1];
  const lastTimestamp = new Date(parseInt(lastCandle[0]));
  console.log(`📅 Last candle timestamp: ${lastTimestamp.toISOString()}`);

  const tag = `MULTICRYPTO_${timeframe}`;
  const modelPath = `./MODELS/${tag}/model.json`;

  if (!fs.existsSync(modelPath)) {
    console.warn(`⚠️ No model found for ${tag}. Skipping.`);
    return;
  }

  const stats = fs.statSync(modelPath);
  const lastModified = new Date(stats.mtime);
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  if (lastModified < twentyFourHoursAgo) {
    console.warn(
      `🚫 Model for ${tag} is older than 24 hours. Skipping prediction.`
    );
    return;
  }

  // Extract close prices and calculate RSI
  const closes = candles.map((c) => parseFloat(c[4]));
  const rsiValues = RSI.calculate({ values: closes, period: 14 });

  if (rsiValues.length < inputSize) {
    console.error(
      `❌ Not enough RSI values. Needed ${inputSize}, got ${rsiValues.length}`
    );
    return;
  }

  // Normalize RSI to 0–1
  const normalizedRSI = rsiValues.map((v) => v / 100);
  const input = normalizedRSI.slice(-inputSize);

  const model = await tf.loadLayersModel("file://" + modelPath);

  const predictedValues = tf.tidy(() => {
    const reshapedInput = input.map((v) => [v]); // shape: [inputSize, 1]
    const inputTensor = tf.tensor3d([reshapedInput]); // shape: [1, inputSize, 1]
    const prediction = model.predict(inputTensor);
    return prediction.arraySync();
  });

  model.dispose();

  console.log(`📈 Live Prediction for ${symbolName} (${timeframe}):`);
  console.log(
    `🧬 RSI Input (last 10): ${input
      .slice(-10)
      .map((p) => p.toFixed(2))
      .join(", ")}`
  );
  console.log(
    `🤖 Predicted Next 12: ${predictedValues[0]
      .map((p) => p.toFixed(2))
      .join(", ")}`
  );

  return predictedValues;
}

function getAdx(candles, period) {
  if (candles.length < period + 1) {
    throw new Error("Not enough candles to calculate ADX");
  }

  const trList = [];
  const plusDM = [];
  const minusDM = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    const currentHigh = parseFloat(current[2]);
    const currentLow = parseFloat(current[3]);
    const currentClose = parseFloat(current[4]);

    const previousHigh = parseFloat(previous[2]);
    const previousLow = parseFloat(previous[3]);
    const previousClose = parseFloat(previous[4]);

    const highDiff = currentHigh - previousHigh;
    const lowDiff = previousLow - currentLow;

    const plus = highDiff > lowDiff && highDiff > 0 ? highDiff : 0;
    const minus = lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0;

    plusDM.push(plus);
    minusDM.push(minus);

    const tr = Math.max(
      currentHigh - currentLow,
      Math.abs(currentHigh - previousClose),
      Math.abs(currentLow - previousClose)
    );
    trList.push(tr);
  }

  const smoothedTR = [trList.slice(0, period).reduce((a, b) => a + b, 0)];
  const smoothedPlusDM = [plusDM.slice(0, period).reduce((a, b) => a + b, 0)];
  const smoothedMinusDM = [minusDM.slice(0, period).reduce((a, b) => a + b, 0)];

  for (let i = period; i < trList.length; i++) {
    smoothedTR.push(smoothedTR.at(-1) - smoothedTR.at(-1) / period + trList[i]);
    smoothedPlusDM.push(
      smoothedPlusDM.at(-1) - smoothedPlusDM.at(-1) / period + plusDM[i]
    );
    smoothedMinusDM.push(
      smoothedMinusDM.at(-1) - smoothedMinusDM.at(-1) / period + minusDM[i]
    );
  }

  const plusDI = smoothedPlusDM.map((val, i) => 100 * (val / smoothedTR[i]));
  const minusDI = smoothedMinusDM.map((val, i) => 100 * (val / smoothedTR[i]));

  const dx = plusDI.map((pdi, i) => {
    const mdi = minusDI[i];
    return (Math.abs(pdi - mdi) / (pdi + mdi)) * 100;
  });

  const adxStart = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const adx = [adxStart];

  for (let i = period; i < dx.length; i++) {
    adx.push((adx.at(-1) * (period - 1) + dx[i]) / period);
  }

  return adx.at(-1); // Return the latest ADX value
}

function getLatestEMA(closes, period) {
  if (!closes || closes.length < period) return null;

  const closePrices = closes;

  const emaValues = EMA.calculate({ period, values: closePrices });

  return emaValues.length > 0 ? emaValues[emaValues.length - 1] : null;
}

function getRelativeHistogramMomentumScore(closes, RUN = 6) {
  const macdInput = {
    values: closes,
    fastPeriod: 12,
    slowPeriod: 144,
    signalPeriod: 7,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  };

  const macd = MACD.calculate(macdInput);
  if (macd.length < RUN) return 0;

  const hist = macd.slice(-RUN).map((p) => p.histogram);

  // Use the last close price to normalize
  const lastPrice = closes[closes.length - RUN - 1];
  if (!lastPrice || lastPrice === 0) return 0;

  // Normalize histogram values as % of last price
  const normHist = hist.map((h) => h / lastPrice);

  // Average normalized histogram
  const avgHist = normHist.reduce((sum, h) => sum + h, 0) / normHist.length;

  // Average change between normalized values (momentum)
  let totalDiff = 0;
  for (let i = 1; i < normHist.length; i++) {
    totalDiff += normHist[i] - normHist[i - 1];
  }
  const avgMomentum = totalDiff / (normHist.length - 1);

  // Trend score (magnitude × direction)
  const score = avgMomentum * Math.abs(avgHist);

  // Optional: Multiply by 100 to express as percent
  const percentScore = score * 100;

  console.log(`Symbol Score: ${percentScore.toFixed(4)}%`);
  return percentScore;
}

function checkConsecutiveHistograms(closes, RUN = 3) {
  const macdInput = {
    values: closes,
    fastPeriod: 12,
    slowPeriod: 24,
    signalPeriod: 7,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  };

  const macd = MACD.calculate(macdInput);

  console.log("checkConsecutiveHistograms");
  if (macd.length < RUN) return 0;

  const hist = macd.slice(-RUN).map((p) => p.histogram);
  console.log("Histograms (latest):", hist);

  let isIncreasing = true;
  let isDecreasing = true;

  for (let i = 1; i < hist.length; i++) {
    const diff = hist[i] - hist[i - 1];
    console.log(`Compare ${hist[i - 1]} -> ${hist[i]} | diff: ${diff}`);

    if (diff <= 0) isIncreasing = false;
    if (diff >= 0) isDecreasing = false;
  }

  if (isIncreasing) {
    console.log(`${RUN} increasing histograms`);
    return 1;
  }
  if (isDecreasing) {
    console.log(`${RUN} decreasing histograms`);
    return -1;
  }

  return 0;
}

function getEmaProximityPercentage(closes, fastPeriod = 7, slowPeriod = 144) {
  const emaFast = EMA.calculate({ period: fastPeriod, values: closes });
  const emaSlow = EMA.calculate({ period: slowPeriod, values: closes });

  const len = Math.min(emaFast.length, emaSlow.length);
  if (len === 0) return null;

  const fast = emaFast.at(-1);
  const slow = emaSlow.at(-1);

  const diff = Math.abs(fast - slow);
  const average = (fast + slow) / 2;

  const percentageDifference = (diff / average) * 100;

  return percentageDifference; // Lower = closer to crossing
}

function getAverageRecentRSI(closingPrices, period = 14) {
  const rsiValues = RSI.calculate({ values: closingPrices, period });

  if (rsiValues.length < period) return null;

  const recentRSIs = rsiValues.slice(-period);
  const average = recentRSIs.reduce((sum, rsi) => sum + rsi, 0) / period;

  return average;
}

function getLatestRSI(closingPrices, period = 14) {
  return RSI.calculate({ values: closingPrices, period }).pop();
}

async function createOrder(symbol, message, volume, value) {
  let database = await connectionMongoose();

  console.log("CREATE ORDER ", symbol, message);

  const timestamp = new Date().getTime();
  const date = new Date();

  const newScanItem = new ScanItem({
    timestamp: timestamp,
    date: date,
    direction: value,
    symbol: symbol,
    signal: message,
    volume: volume,
  });

  await newScanItem.save();
  console.log("ScanItem saved successfully:", newScanItem);
}

function getLatestEmaScore(closes, fastPeriod, slowPeriod) {
  const emaFast = EMA.calculate({ period: fastPeriod, values: closes });
  const emaSlow = EMA.calculate({ period: slowPeriod, values: closes });

  const minLength = Math.min(emaFast.length, emaSlow.length);
  if (minLength === 0) return null; // Not enough data

  const fast = emaFast.at(-1);
  const slow = emaSlow.at(-1);

  return fast - slow;
}

function getRelativeChangePercentage(latest, past) {
  if (past === 0) {
    if (latest === 0) return 0;
    return latest > 0 ? Infinity : -Infinity;
  }

  const delta = latest - past;
  const percentage = (delta / Math.abs(past)) * 100;
  return percentage;
}

async function downloadCloses(SYMBOL, client, timeframe) {
  try {
    const symbol = SYMBOL;
    const limit = 200;

    const timeframeToMs = {
      1: 60 * 1000,
      3: 3 * 60 * 1000,
      5: 5 * 60 * 1000,
      15: 15 * 60 * 1000,
      30: 30 * 60 * 1000,
      60: 60 * 60 * 1000,
      120: 120 * 60 * 1000,
      240: 240 * 60 * 1000,
      D: 24 * 60 * 60 * 1000,
    };

    const msPerCandle = timeframeToMs[timeframe];
    if (!msPerCandle) throw new Error(`Unsupported timeframe: ${timeframe}`);

    const endTimestamp = Date.now();
    const startTimestamp = endTimestamp - limit * msPerCandle;

    const response = await client.getKline({
      category: "linear",
      symbol: symbol,
      interval: timeframe,
      start: startTimestamp,
      end: endTimestamp,
      limit: limit,
    });

    const candles = response.result.list;

    // Check order
    for (let i = 1; i < candles.length; i++) {
      const prevTime = parseInt(candles[i - 1][0]);
      const currTime = parseInt(candles[i][0]);
      if (currTime < prevTime) {
        console.warn(
          "Candles are not sorted from oldest to newest. Reversing..."
        );
        candles.reverse();
        break;
      }
    }

    const close_candles = candles.map((candle) => parseFloat(candle[4]));
    return close_candles;
  } catch (error) {
    console.error(error);
    return [];
  }
}

async function downloadCandles(SYMBOL, client, timeframe) {
  console.log("DOWNLOAD CANDLES ", SYMBOL, timeframe);

  try {
    const symbol = SYMBOL;
    const limit = 200;

    const timeframeToMs = {
      1: 60 * 1000,
      3: 3 * 60 * 1000,
      5: 5 * 60 * 1000,
      15: 15 * 60 * 1000,
      30: 30 * 60 * 1000,
      60: 60 * 60 * 1000,
      120: 120 * 60 * 1000,
      240: 240 * 60 * 1000,
      D: 24 * 60 * 60 * 1000,
    };

    const msPerCandle = timeframeToMs[timeframe];
    if (!msPerCandle) throw new Error(`Unsupported timeframe: ${timeframe}`);

    const endTimestamp = Date.now();
    const startTimestamp = endTimestamp - limit * msPerCandle;

    const response = await client.getKline({
      category: "linear",
      symbol: symbol,
      interval: timeframe,
      start: startTimestamp,
      end: endTimestamp,
      limit: limit,
    });

    const candles = response.result.list;

    // Check order
    for (let i = 1; i < candles.length; i++) {
      const prevTime = parseInt(candles[i - 1][0]);
      const currTime = parseInt(candles[i][0]);
      if (currTime < prevTime) {
        console.warn(
          "Candles are not sorted from oldest to newest. Reversing..."
        );
        candles.reverse();
        break;
      }
    }

    return candles;
  } catch (error) {
    console.error(error);
    return [];
  }
}

async function getAverageHourlyVolume(SYMBOL, client) {
  try {
    const interval = "1"; // 1-minute candles
    const symbol = SYMBOL;

    const minutes = 60;
    const endTimestamp = Date.now();
    const startTimestamp = endTimestamp - minutes * 60 * 1000; // last 60 minutes

    const response = await client.getKline({
      category: "linear",
      symbol: symbol,
      interval: interval,
      start: startTimestamp,
      end: endTimestamp,
      limit: 60,
    });

    let volumes = response.result.list.map((candle) => parseFloat(candle[6]));

    let totalVolume = volumes.reduce((sum, vol) => sum + vol, 0);
    let averageVolume = totalVolume / volumes.length;

    return averageVolume;
  } catch (error) {
    console.error("Error in getAverageHourlyVolume:", error);
    return null;
  }
}

function getTimestampDaysAgo(days) {
  const now = new Date();
  const timestamp = now.getTime() - days * 24 * 60 * 60 * 1000;
  return timestamp;
}

deleteOldEntries();
scanItems();

cron.schedule("*/5 * * * *", async () => {
  console.log("Running a task every minute");
  await deleteOldEntries();

  await scanItems();
});

async function deleteOldEntries() {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours in milliseconds
    const result = await ScanItem.deleteMany({ date: { $lt: cutoff } });
    console.log(`Deleted ${result.deletedCount} entries older than 24 hours`);
  } catch (error) {
    console.error("Error deleting old entries:", error);
  }
}

async function purchaseBybitMarket(amount, operation, symbol) {
  const QTY_LEVERAGE = 100;

  let AMOUNT_TO_PURCHASE = amount;

  console.log("purchaseBybitMarket ", symbol, amount);

  const bybit_client = new RestClientV5(
    {
      key: apiKey,
      secret: apiSecret,
      testnet: test_net,
      // Optional: enable to try parsing rate limit values from responses
      // parseAPIRateLimits: true
    }
    // requestLibraryOptions
  );

  function calculateNewPrice(assetPrice, percentage) {
    let change = assetPrice * (percentage / 100);

    // Calculate the new price by adding the change to the original price
    let newAssetPrice = assetPrice + change;

    return newAssetPrice;
  }

  await bybit_client.setLeverage({
    category: "linear",
    symbol: symbol,
    buyLeverage: LEVERAGE.toString(),
    sellLeverage: LEVERAGE.toString(),
  });

  //---------------------- GET CURRENT SYMBOL VALUE

  let time = new Date().now;

  let k_line = await bybit_client.getKline({
    category: "linear",
    symbol: symbol,
    interval: 1,
    start: time,
    end: time,
    limit: 1,
  });

  console.log("K LINE ", k_line);

  let k_line_result = k_line.result;

  let k_line_result_list = k_line_result.list[0];

  const ASSET_PRICE = parseFloat(k_line_result_list[4]);

  const ASSET_VOLUME = parseFloat(k_line_result_list[5]);

  const TURN_OVER = parseFloat(k_line_result_list[6]);

  const USDT_VOLUME = ASSET_PRICE * ASSET_VOLUME;

  console.log("ASSET PRICE ", symbol, ASSET_PRICE);

  var STOP_LOSS_PRICE = 0;
  var v = 0;

  var ENTRY_PRICE_WITH_LIMIT = 0;

  //----------------------- GET CURRENT SYMBOL VALUE

  let order_parameters = {};

  order_parameters.category = "linear";
  order_parameters.symbol = symbol;
  order_parameters.isLeverage = 1;

  if (operation === "POSITIVE") {
    order_parameters.side = "Buy";

    TAKE_PROFIT_PRICE = calculateNewPrice(
      ASSET_PRICE,
      TAKE_PROFIT_PRICE_PERCENTAGE_MOMENTUM
    );
    STOP_LOSS_PRICE = calculateNewPrice(
      ASSET_PRICE,
      -STOP_LOSS_PRICE_PERCENTAGE_MOMENTUM
    );

    console.log("BUY ", "STOP LOSS ", STOP_LOSS_PRICE);

    order_parameters.triggerDirection = 2;
  }

  if (operation === "NEGATIVE") {
    order_parameters.side = "Sell";

    TAKE_PROFIT_PRICE = calculateNewPrice(
      ASSET_PRICE,
      -TAKE_PROFIT_PRICE_PERCENTAGE_MOMENTUM
    );
    STOP_LOSS_PRICE = calculateNewPrice(
      ASSET_PRICE,
      STOP_LOSS_PRICE_PERCENTAGE_MOMENTUM
    );

    console.log("SELL ", "STOP LOSS ", STOP_LOSS_PRICE);

    order_parameters.triggerDirection = 1;
  }

  let QUANTITY_STEP = await qtyStep(symbol);

  // Convert the number to a string and split it at the decimal point
  let qtyStepString = QUANTITY_STEP.toString();
  let decimals = 0;

  if (qtyStepString.includes(".")) {
    // Get the length of the decimal part
    decimals = qtyStepString.split(".")[1].length;
  }

  let QUANTITY_TO_PURCHASE = AMOUNT_TO_PURCHASE / ASSET_PRICE;

  //------ set to the closes quantity purchase

  QUANTITY_TO_PURCHASE =
    Math.round(QUANTITY_TO_PURCHASE / QUANTITY_STEP) * QUANTITY_STEP;

  QUANTITY_TO_PURCHASE = QUANTITY_TO_PURCHASE.toFixed(decimals);

  //------ set to the closes quantity purchase

  order_parameters.orderType = "Market";

  console.log(
    "BYBIT ORDER QUANTITY TO PURCHASE ",
    QUANTITY_TO_PURCHASE.toString()
  );

  order_parameters.qty = QUANTITY_TO_PURCHASE.toString();
  order_parameters.marketUnit = "baseCoin";

  console.log("ASSET PRICE ", ASSET_PRICE);

  console.log("STOP LOSS ", STOP_LOSS_PRICE);

  console.log("TAKE PROFIT ", TAKE_PROFIT_PRICE);

  console.log("BYBIT ORDER ", order_parameters);

  //------------- stop loss
  order_parameters.stopLoss = STOP_LOSS_PRICE.toString();
  order_parameters.takeProfit = TAKE_PROFIT_PRICE.toString();

  order_parameters.slTriggerBy = "MarkPrice";

  //------------- stop loss

  let order = await bybit_client.submitOrder(order_parameters);

  let make_order = {};
  make_order.timeCreated = new Date().getTime();
  make_order.symbol = symbol;

  console.log("BYBIT ORDER RESPONSE MOMENTUM", order);
}

async function qtyStep(SYMBOL) {
  const bybit_client = new RestClientV5(
    {
      key: apiKey,
      secret: apiSecret,
      testnet: test_net,
      // Optional: enable to try parsing rate limit values from responses
      // parseAPIRateLimits: true
    }
    // requestLibraryOptions
  );

  let response = await bybit_client.getInstrumentsInfo({
    category: "linear",
    symbol: SYMBOL,
  });

  let order_response = response.result.list[0];

  let lotSizeFilter = order_response.lotSizeFilter;

  console.log("QUANTITY STEP ", lotSizeFilter.qtyStep);

  let qtyStep = lotSizeFilter.qtyStep;

  return qtyStep;
}

async function getPositionDirection(
  symbol,
  category = "linear",
  testnet = false
) {
  const client = new RestClientV5({
    key: apiKey,
    secret: apiSecret,
    testnet,
  });

  try {
    const result = await client.getPositionInfo({ category, symbol });

    const positions = result.result?.list;
    if (!positions || positions.length === 0) return "NONE";

    const activePosition = positions.find((pos) => parseFloat(pos.size) !== 0);

    if (!activePosition) return "NONE";

    const direction = activePosition.side === "Buy" ? "LONG" : "SHORT";
    return direction;
  } catch (err) {
    console.error("Error checking position:", err?.message || err);
    return "ERROR";
  }
}

try {
  // Run every hour at minute 0
  cron.schedule("0 * * * *", async () => {
    console.log("🔁 Hourly interval task running");

    for (const symbol of SYMBOLS_TO_TRADE) {
      await cancelAllOpenOrdersBySymbol(symbol);
      //  await closePosition(symbol);
      await createOrder(
        symbol,
        "HOURLY SCHEDULE",
        0,
        "DELETE ALL ORDERS AND POSITIONS"
      );
    }
  });
} catch (scheduleErr) {
  console.error("❌ Cron job failed to initialize:", scheduleErr.message);
}

async function getMarginBalance() {
  const client = new RestClientV5({
    key: apiKey,
    secret: apiSecret,
    testnet: test_net,
  });

  try {
    const result = await client.getWalletBalance({
      accountType: "UNIFIED", // Use "CONTRACT" if you're not on UTA
      coin: "USDT",
    });

    const usdtBalance = result.result.list[0].coin.find(
      (c) => c.coin === "USDT"
    );

    if (usdtBalance) {
      const equity = parseFloat(usdtBalance.equity);
      const availableBalance = parseFloat(usdtBalance.availableToWithdraw);
      console.log(
        `💰 Margin Balance (USDT): ${equity} | Available: ${availableBalance}`
      );
      return { equity, availableBalance };
    } else {
      console.warn("⚠️ USDT balance not found.");
      return null;
    }
  } catch (err) {
    console.error("❌ Error fetching margin balance:", err.message || err);
    return null;
  }
}

async function cancelOrdersOlderThan(symbol, maxAgeMinutes = 30) {
  const client = new RestClientV5({
    key: apiKey,
    secret: apiSecret,
    testnet: test_net,
  });

  try {
    const response = await client.getActiveOrders({
      category: "linear",
      symbol: symbol,
    });

    const orders = response.result.list || [];
    const now = Date.now();
    const maxAgeMs = maxAgeMinutes * 60 * 1000;

    for (const order of orders) {
      console.log("Order ", order);
      const createdTime = parseInt(order.createdTime);
      const age = now - createdTime;

      // Skip if it's a StopLoss or TakeProfit order
      if (["TakeProfit", "StopLoss"].includes(order.stopOrderType)) continue;

      // Cancel if it's older than the threshold
      if (age > maxAgeMs) {
        await client.cancelOrder({
          category: "linear",
          symbol,
          orderId: order.orderId,
        });
        console.log(
          `🕒 Canceled regular order ${
            order.orderId
          } on ${symbol} (age: ${Math.round(age / 60000)} min)`
        );
      }
    }
  } catch (err) {
    console.error("❌ Error cancelling old orders:", err.message || err);
  }
}

cron.schedule("*/5 * * * *", async () => {
  console.log("🔍 Checking and cleaning old non-TP/SL orders...");

  for (const symbol of SYMBOLS_TO_TRADE) {
    await cancelOrdersOlderThan(symbol, 60);
  }
});

createOrder(
  "MULTI-SYMBOLS",
  "SESSION STARTS",
  0,
  " TRADING SESSION STARTS " + AI_VERSION
);

async function closeOldPositions(hours = 2) {
  const client = new RestClientV5({
    key: apiKey,
    secret: apiSecret,
    testnet: test_net,
  });

  const maxAgeMs = hours * 60 * 60 * 1000;

  console.log(
    `🔍 Checking all positions for age (auto-close if > ${hours} hour(s))...`
  );

  for (const symbol of SYMBOLS_TO_TRADE) {
    try {
      const result = await client.getPositionInfo({
        category: "linear",
        symbol,
      });

      const positions = result.result?.list || [];

      for (const position of positions) {
        const size = parseFloat(position.size);
        const openTime = parseInt(position.updatedTime);
        const side = position.side.toLowerCase();
        const closeSide = side === "buy" ? "Sell" : "Buy";

        if (!openTime || isNaN(openTime) || size === 0) continue;

        const ageMs = Date.now() - openTime;
        const ageMinutes = Math.round(ageMs / 60000);

        // Log position age even if it's not closing

        console.log("OPEN TIME ", openTime);
        await createOrder(
          symbol,
          "POSITION-AGE",
          0,
          `Open for ${ageMinutes} mins (side: ${side}, size: ${size})`
        );

        if (ageMs > maxAgeMs) {
          console.log(`🕒 Closing ${symbol} after ${ageMinutes} minutes`);

          await client.submitOrder({
            category: "linear",
            symbol,
            side: closeSide,
            orderType: "Market",
            qty: position.size,
            reduceOnly: true,
            marketUnit: "baseCoin",
          });

          await createOrder(
            symbol,
            "AUTO-CLOSE",
            0,
            `Closed after >${hours}h (${ageMinutes} mins)`
          );
        }
      }
    } catch (err) {
      console.error(`❌ Error checking ${symbol}:`, err.message || err);
    }
  }
}

cron.schedule("*/5 * * * *", async () => {
  console.log("🔁 Scheduled check: Closing positions older than 2 hours");
  await closeOldPositions(24); // 2 = hours
});
closeOldPositions(24);
