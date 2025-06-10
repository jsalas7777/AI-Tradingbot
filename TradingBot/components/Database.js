const { MongoClient } = require("mongodb");
const mongoose = require('mongoose');



const uri = 'mongodb+srv://aibucketmain:FNK35W9XFRSt8tuv@aibucket.q14dd.mongodb.net/?retryWrites=true&w=majority&appName=aibucket';
const client = new MongoClient(uri);

let database;

async function connectToDatabase() {
    if (!database) {
        try {
            await client.connect();
            console.log('Connected to MongoDB');
            database = client.db('TradingSimulator'); // Replace with your DB name
        } catch (error) {
            console.error('Error connecting to MongoDB:', error);
            throw error;
        }
    }
    return database;
}


async function connectionMongoose() {
    console.log('Attempting to connect to MongoDB...');
    try {
        const dbUrl = uri;  // Replace with your MongoDB URL
        await mongoose.connect(dbUrl);
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('Error connecting to MongoDB:', error.message);
        throw error; // Ensure that errors are thrown and not swallowed
    }
}



connectToDatabase();


module.exports = { connectToDatabase,connectionMongoose };
