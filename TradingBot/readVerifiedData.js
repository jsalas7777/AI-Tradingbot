const fs = require('fs');
const path = require('path');

const directoryPath = './verified_bybit_data';

fs.readdir(directoryPath, (err, files) => {
    if (err) {
        console.error('Error reading directory:', err);
        return;
    }
    
    const fileNames = files.map(file => path.parse(file).name.replace('_kline_data', ''));

    console.log(JSON.stringify(fileNames));
});
