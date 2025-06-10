const mongoose = require('mongoose');

const ScanItemSchema = new mongoose.Schema({
    timestamp: { type: Number, required: true },
    date: { type: Date, required: true },
    direction: { type: String, required: true },
    symbol: { type: String, required: true },
    signal: { type: String },// Added property
    volume: { type: Number } // Added property

}, { timestamps: true });

const ScanItem = mongoose.model('ScanItem', ScanItemSchema);

module.exports = ScanItem;
