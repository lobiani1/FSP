const fs = require('fs');
const zlib = require('zlib');

process.on('message', ({ inputPath, outputPath }) => {
   
    fs.stat(inputPath, (err, stats) => {
        if (err || !stats.isFile()) {
            process.send({ success: false, error: `Input file does not exist: ${inputPath}` });
            return;
        }

        const gzip = zlib.createGzip();
        const inputStream = fs.createReadStream(inputPath);
        const outputStream = fs.createWriteStream(outputPath);

        inputStream.pipe(gzip).pipe(outputStream);

        outputStream.on('finish', () => {
            process.send({ success: true });
        });

        outputStream.on('error', (error) => {
            process.send({ success: false, error: `Compression error: ${error.message}` });
        });

        inputStream.on('error', (error) => {
            process.send({ success: false, error: `Input stream error: ${error.message}` });
        });
    });
});
