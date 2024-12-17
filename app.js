const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const { fork } = require('child_process');
const zlib = require('zlib');
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');
const multer = require('multer');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const { generateToken, verifyToken } = require('./utils/auth');
const { initStorage, saveUser, getUser, deleteUser, createItem, listUserItems, deleteItem, uploadFile, attachMetadata, getMetadata, getFile, deleteUserData } = require('./utils/storage');
dotenv.config();

const app = express();
const upload = multer();
const USERS_DIR = path.join(__dirname, process.env.USERS_DIR || 'users'); // Use process.env for configuration
const DOWNLOADS_DIR = path.join(__dirname, process.env.DOWNLOADS_DIR || 'downloads');
const DOWNLOAD_LINK_EXPIRATION_MINUTES = parseInt(process.env.DOWNLOAD_LINK_EXPIRATION_MINUTES, 10) || 60;
app.use(bodyParser.json());

// Store active links and their expiration time
const activeLinks = {};

const PORT = 3000;

// Initialize storage
initStorage();

// User Registration
app.post('/api/v1/user/create', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send({ message: 'Invalid input' });

  const userId = username; // Use username as unique identifier
  const existingUser = await getUser(userId);
  if (existingUser) return res.status(400).send({ message: 'User already exists' });

  const hashedPassword = await bcrypt.hash(password, 10);
  const userData = { username, password: hashedPassword };
  await saveUser(userId, userData);

  res.status(201).send({ message: 'User registered successfully' });
});

// User Validation
app.post('/api/v1/user/validate', async (req, res) => {
  const { username } = req.body;
  const userId = username;
  const user = await getUser(userId);

  if (!user) return res.status(404).send({ message: 'User not found' });
  res.status(200).send({ message: 'User is valid' });
});

// User Login
app.post('/api/v1/user/login', async (req, res) => {
  const { username, password } = req.body;
  const userId = username;
  const user = await getUser(userId);

  if (!user) return res.status(404).send({ message: 'User not found' });

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) return res.status(401).send({ message: 'Invalid credentials' });

  const token = generateToken({ userId });
  res.status(200).send({ message: 'Login successful', token });
});

// Delete User
app.post('/api/v1/user/delete', async (req, res) => {
  const { token } = req.headers;
  try {
    const decoded = verifyToken(token);
    await deleteUser(decoded.userId);
    res.status(200).send({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(401).send({ message: 'Unauthorized' });
  }
});



// Middleware to extract userId from JWT
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  try {
    const decoded = verifyToken(token);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).send({ message: 'Unauthorized' });
  }
}

// List all items
app.get('/api/v1/user/space', authenticate, async (req, res) => {
  try {
    const items = await listUserItems(req.userId);
    res.status(200).send(items);
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});

// Create a folder or file
app.put('/api/v1/user/space/create', authenticate, async (req, res) => {
  const { itemName, isFolder = true } = req.body;
  if (!itemName) return res.status(400).send({ message: 'Item name is required' });

  try {
    await createItem(req.userId, itemName, isFolder);
    res.status(201).send({ message: 'Item created successfully' });
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});

// Delete a file or folder (only empty folders can be deleted)
app.delete('/api/v1/user/space/file', authenticate, async (req, res) => {
  const { itemName } = req.body;
  if (!itemName) return res.status(400).send({ message: 'Item name is required' });

  try {
    await deleteItem(req.userId, itemName);
    res.status(200).send({ message: 'Item deleted successfully' });
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});


// Middleware to authenticate users
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  try {
    const decoded = verifyToken(token);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).send({ message: 'Unauthorized' });
  }
}

// Upload a file
app.post('/api/v1/user/space/upload', authenticate, upload.single('file'), async (req, res) => {
    const { file } = req;
    const { fileName } = req.body;

    if (!file || !fileName) {
        return res.status(400).send({ message: 'File and fileName are required' });
    }

    try {
        const tempPath = path.join(DOWNLOADS_DIR, fileName); // Temporary upload location
        await fs.outputFile(tempPath, file.buffer); // Save the uploaded file

        const compressedPath = `${tempPath}.gz`; // Compressed file location

        // Use the child process to compress the file
        await compressFile(tempPath, compressedPath);

        // Move the compressed file to the user’s space
        await uploadFile(req.userId, await fs.readFile(compressedPath), `${fileName}.gz`);

        res.status(201).send({ message: 'File uploaded and compressed successfully' });

        // Clean up temporary files
        fs.remove(tempPath);
        fs.remove(compressedPath);
    } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Error uploading file' });
    }
});


// Attach metadata to a file or folder
app.post('/api/v1/user/space/meta', authenticate, async (req, res) => {
  const { itemName, metadata } = req.body;

  if (!itemName || !metadata) {
    return res.status(400).send({ message: 'Item name and metadata are required' });
  }

  try {
    await attachMetadata(req.userId, itemName, metadata);
    res.status(201).send({ message: 'Metadata attached successfully' });
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});

// Retrieve metadata
app.get('/api/v1/user/space/meta', authenticate, async (req, res) => {
  const { itemName } = req.query;

  if (!itemName) {
    return res.status(400).send({ message: 'Item name is required' });
  }

  try {
    const metadata = await getMetadata(req.userId, itemName);
    res.status(200).send(metadata);
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});

// Helper function to create a zip of a folder
function zipFolder(folderPath, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(zipPath));
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(folderPath, false);
    archive.finalize();
  });
}

// Generate a secure, short download link
app.get('/api/v1/user/share', authenticate, async (req, res) => {
  const { itemName } = req.query;
  const userDir = path.join(USERS_DIR, req.userId);
  const itemPath = path.join(userDir, itemName);

  if (!itemName) {
    return res.status(400).send({ message: 'Item name is required' });
  }

  // Check if the item exists
  if (!(await fs.pathExists(itemPath))) {
    return res.status(404).send({ message: 'Item not found' });
  }

  const shortLinkId = uuidv4();
  const expirationTime = Date.now() + DOWNLOAD_LINK_EXPIRATION_MINUTES * 60000; // Expire after configurable minutes
  const downloadLink = `/download/${shortLinkId}`;

  // Store the short link with expiration time
  activeLinks[shortLinkId] = {
    itemPath,
    expirationTime,
    isFolder: (await fs.lstat(itemPath)).isDirectory()
  };

  res.status(200).send({ downloadLink });
});

// Download file or folder by short link
app.get('/download/:id', async (req, res) => {
  const { id } = req.params;
  const linkData = activeLinks[id];

  if (!linkData) {
    return res.status(404).send({ message: 'Link not found' });
  }

  const currentTime = Date.now();
  if (linkData.expirationTime < currentTime) {
    // If the link has expired, remove it from activeLinks
    delete activeLinks[id];
    return res.status(410).send({ message: 'Link has expired' });
  }

  const itemPath = linkData.itemPath;

  if (linkData.isFolder) {
    // If it's a folder, zip it before sending
    const zipPath = path.join(DOWNLOADS_DIR, `${id}.zip`);
    try {
      await zipFolder(itemPath, zipPath);
      res.download(zipPath, err => {
        if (err) {
          res.status(500).send({ message: 'Error in file download' });
        }
        fs.remove(zipPath); // Remove the zip file after download
      });
    } catch (err) {
      res.status(500).send({ message: 'Error zipping folder' });
    }
  } else {
    // If it's a file, just send it directly
    res.download(itemPath, err => {
      if (err) {
        res.status(500).send({ message: 'Error in file download' });
      }
    });
  }

  // Once the link is used, remove it from activeLinks
  delete activeLinks[id];
});





// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nGracefully shutting down...');
  process.exit(0); // Clean exit
});

process.on('SIGTERM', () => {
  console.log('Termination signal received. Shutting down...');
  process.exit(0); // Clean exit
});

// Logging using stdout and stderr
console.log('Starting the server...');
process.stderr.write('Errors will be logged here.\n');
process.stdout.write(`Server will run on port ${PORT}\n`);

// Forked child process for file compression during uploads
function compressFile(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
      const child = fork('./utils/compressFile.js'); // Fork a child process for compression

      child.send({ inputPath, outputPath }); // Send paths to the child process

      child.on('message', (message) => {
          if (message.success) {
              resolve();
          } else {
              reject(new Error(message.error));
          }
      });

      child.on('error', reject);
  });
}

// File upload with compression
app.post('/api/v1/user/space/upload', authenticate, upload.single('file'), async (req, res) => {
  const { file } = req;
  const { fileName } = req.body;

  if (!file || !fileName) {
      return res.status(400).send({ message: 'File and fileName are required' });
  }

  try {
      const tempPath = path.join(DOWNLOADS_DIR, fileName); // Temporary upload location
      await fs.outputFile(tempPath, file.buffer); // Save the uploaded file

      const compressedPath = `${tempPath}.gz`; // Compressed file location
      await compressFile(tempPath, compressedPath); // Use child process to compress

      // Move the compressed file to the user’s space
      await uploadFile(req.userId, await fs.readFile(compressedPath), `${fileName}.gz`);
      res.status(201).send({ message: 'File uploaded and compressed successfully' });

      // Clean up temporary files
      fs.remove(tempPath);
      fs.remove(compressedPath);
  } catch (err) {
      console.error(err);
      res.status(500).send({ message: 'Error uploading file' });
  }
});

// Zip folder implementation for sharing
function zipFolder(folderPath, zipPath) {
  return new Promise((resolve, reject) => {
      const child = fork('./utils/zipFolder.js'); // Fork a child process for zipping
      child.send({ folderPath, zipPath });

      child.on('message', (message) => {
          if (message.success) {
              resolve();
          } else {
              reject(new Error(message.error));
          }
      });

      child.on('error', reject);
  });
}
// Download a file
app.get('/api/v1/user/space/download', authenticate, async (req, res) => {
  const { itemName } = req.query;
  
  if (!itemName) {
    return res.status(400).send({ message: 'Item name is required' });
  }

  try {
    // Retrieve file from storage (e.g., file system or database)
    const file = await getFile(req.userId, itemName); // This function should be implemented in your storage logic
    if (!file) {
      return res.status(404).send({ message: 'File not found' });
    }
    
    // Send the file as a download
    res.download(file.path, file.name); // Adjust based on your storage system
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});

app.get('/api/v1/user/space/download/:fileName', authenticate, async (req, res) => {
  const { fileName } = req.params;
  const compressedFilePath = path.join(DOWNLOADS_DIR, `${fileName}.gz`); // Path to the compressed file

  try {
    // Check if the file exists
    const fileExists = await fs.pathExists(compressedFilePath);
    if (!fileExists) {
      return res.status(404).send({ message: 'File not found' });
    }

    // Create a read stream from the compressed file
    const readStream = fs.createReadStream(compressedFilePath);
    const unzip = zlib.createGunzip(); // Decompression stream

    // Pipe the decompressed data directly to the response
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    readStream.pipe(unzip).pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Error downloading file' });
  }
});



// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
