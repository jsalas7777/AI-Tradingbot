const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');
const { stringify } = require('csv-stringify');

// Define the verification time interval (in milliseconds)
const VERIFY_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Input and output paths
const inputDir = './bybit_data'; // Input directory path
const outputDir = './verified_bybit_data'; // Output directory path

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// Get a list of all CSV files in the input directory
fs.readdir(inputDir, (err, files) => {
  if (err) {
    console.error('Error reading input directory:', err);
    return;
  }

  // Filter only CSV files
  const csvFiles = files.filter(file => file.endsWith('.csv'));

  // Process each CSV file
  csvFiles.forEach(file => {
    const inputFile = path.join(inputDir, file);
    const outputFile = path.join(outputDir, file);

    let data = [];

    // Read and parse the CSV file
    fs.createReadStream(inputFile)
      .pipe(csv())
      .on('data', (row) => {
        // Adjust for the new CSV headers
        const parsedRow = {
          timestamp: row['Timestamp'],
          open: row['Open Price'],
          high: row['High Price'],
          low: row['Low Price'],
          close: row['Close Price'],
          volume: row['Volume'],
          duplicate: 'false',  // No duplicates by default
        };
        data.push(parsedRow);
      })
      .on('end', () => {
        // Sort the rows by timestamp (ascending order)
        data.sort((a, b) => parseInt(a.timestamp) - parseInt(b.timestamp));

        let lastTimestamp = null;

        data = data.reduce((acc, row) => {
          const currentTimestamp = parseInt(row.timestamp);

          // If there's a gap, fill it
          if (lastTimestamp !== null && currentTimestamp - lastTimestamp > VERIFY_INTERVAL) {
            const missingTimestamps = Math.floor((currentTimestamp - lastTimestamp) / VERIFY_INTERVAL);

            // Insert a new row for each missing timestamp
            for (let i = 1; i < missingTimestamps; i++) {
              const missingRowTimestamp = lastTimestamp + i * VERIFY_INTERVAL; // Add the missing interval

              // Log the generated timestamp for debugging
              console.log('Missing Timestamp:', new Date(missingRowTimestamp).toISOString());

              const missingRow = {
                timestamp: missingRowTimestamp.toString(),
                open: row.open,
                high: row.high,
                low: row.low,
                close: row.close,
                volume: row.volume,
                duplicate: 'true'  // Set 'duplicate' to true
              };
              acc.push(missingRow); // Add the missing row to the array
            }
          }

          // Add the current row to the array
          acc.push(row);
          lastTimestamp = currentTimestamp;

          return acc;
        }, []);

        // Write the modified data to the output file as CSV
        stringify(data, { header: true, columns: ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'duplicate'] }, (err, output) => {
          if (err) {
            console.error('Error writing CSV file:', err);
          } else {
            fs.writeFileSync(outputFile, output);
            console.log('CSV file written to:', outputFile);
          }
        });
      });
  });
});
