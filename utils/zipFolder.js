const archiver = require('archiver');
const fs = require('fs');

process.on('message', ({ folderPath, zipPath }) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
        process.send({ success: true });
    });

    archive.on('error', (err) => {
        process.send({ success: false, error: err.message });
    });

    archive.pipe(output);
    archive.directory(folderPath, false);
    archive.finalize();
});
