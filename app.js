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
const USERS_DIR = path.join(__dirname, process.env.USERS_DIR || 'users'); 
const DOWNLOADS_DIR = path.join(__dirname, process.env.DOWNLOADS_DIR || 'downloads');
const DOWNLOAD_LINK_EXPIRATION_MINUTES = parseInt(process.env.DOWNLOAD_LINK_EXPIRATION_MINUTES, 10) || 60;
app.use(bodyParser.json());


const activeLinks = {};

const PORT = 3000;


initStorage();


app.post('/api/v1/user/create', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send({ message: 'Invalid input' });

  const userId = username; 
  const existingUser = await getUser(userId);
  if (existingUser) return res.status(400).send({ message: 'User already exists' });

  const hashedPassword = await bcrypt.hash(password, 10);
  const userData = { username, password: hashedPassword };
  await saveUser(userId, userData);

  res.status(201).send({ message: 'User registered successfully' });
});


app.post('/api/v1/user/validate', async (req, res) => {
  const { username } = req.body;
  const userId = username;
  const user = await getUser(userId);

  if (!user) return res.status(404).send({ message: 'User not found' });
  res.status(200).send({ message: 'User is valid' });
});


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


app.get('/api/v1/user/space', authenticate, async (req, res) => {
  try {
    const items = await listUserItems(req.userId);
    res.status(200).send(items);
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});


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


app.post('/api/v1/user/space/upload', authenticate, upload.single('file'), async (req, res) => {
    const { file } = req;
    const { fileName } = req.body;

    if (!file || !fileName) {
        return res.status(400).send({ message: 'File and fileName are required' });
    }

    try {
        const tempPath = path.join(DOWNLOADS_DIR, fileName); 
        await fs.outputFile(tempPath, file.buffer); 

        const compressedPath = `${tempPath}.gz`; 

        
        await compressFile(tempPath, compressedPath);

        
        await uploadFile(req.userId, await fs.readFile(compressedPath), `${fileName}.gz`);

        res.status(201).send({ message: 'File uploaded and compressed successfully' });

        
        fs.remove(tempPath);
        fs.remove(compressedPath);
    } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Error uploading file' });
    }
});



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


app.get('/api/v1/user/share', authenticate, async (req, res) => {
  const { itemName } = req.query;
  const userDir = path.join(USERS_DIR, req.userId);
  const itemPath = path.join(userDir, itemName);

  if (!itemName) {
    return res.status(400).send({ message: 'Item name is required' });
  }

  
  if (!(await fs.pathExists(itemPath))) {
    return res.status(404).send({ message: 'Item not found' });
  }

  const shortLinkId = uuidv4();
  const expirationTime = Date.now() + DOWNLOAD_LINK_EXPIRATION_MINUTES * 60000; 
  const downloadLink = `/download/${shortLinkId}`;


  activeLinks[shortLinkId] = {
    itemPath,
    expirationTime,
    isFolder: (await fs.lstat(itemPath)).isDirectory()
  };

  res.status(200).send({ downloadLink });
});


app.get('/download/:id', async (req, res) => {
  const { id } = req.params;
  const linkData = activeLinks[id];

  if (!linkData) {
    return res.status(404).send({ message: 'Link not found' });
  }

  const currentTime = Date.now();
  if (linkData.expirationTime < currentTime) {
   
    delete activeLinks[id];
    return res.status(410).send({ message: 'Link has expired' });
  }

  const itemPath = linkData.itemPath;

  if (linkData.isFolder) {
    
    const zipPath = path.join(DOWNLOADS_DIR, `${id}.zip`);
    try {
      await zipFolder(itemPath, zipPath);
      res.download(zipPath, err => {
        if (err) {
          res.status(500).send({ message: 'Error in file download' });
        }
        fs.remove(zipPath); 
      });
    } catch (err) {
      res.status(500).send({ message: 'Error zipping folder' });
    }
  } else {
   
    res.download(itemPath, err => {
      if (err) {
        res.status(500).send({ message: 'Error in file download' });
      }
    });
  }

  
  delete activeLinks[id];
});






process.on('SIGINT', () => {
  console.log('\nGracefully shutting down...');
  process.exit(0); 
});

process.on('SIGTERM', () => {
  console.log('Termination signal received. Shutting down...');
  process.exit(0); 
});


console.log('Starting the server...');
process.stderr.write('Errors will be logged here.\n');
process.stdout.write(`Server will run on port ${PORT}\n`);


function compressFile(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
      const child = fork('./utils/compressFile.js'); 

      child.send({ inputPath, outputPath }); 

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

app.post('/api/v1/user/space/upload', authenticate, upload.single('file'), async (req, res) => {
  const { file } = req;
  const { fileName } = req.body;

  if (!file || !fileName) {
      return res.status(400).send({ message: 'File and fileName are required' });
  }

  try {
      const tempPath = path.join(DOWNLOADS_DIR, fileName); 
      await fs.outputFile(tempPath, file.buffer); 

      const compressedPath = `${tempPath}.gz`; 
      await compressFile(tempPath, compressedPath); 

      
      await uploadFile(req.userId, await fs.readFile(compressedPath), `${fileName}.gz`);
      res.status(201).send({ message: 'File uploaded and compressed successfully' });

      
      fs.remove(tempPath);
      fs.remove(compressedPath);
  } catch (err) {
      console.error(err);
      res.status(500).send({ message: 'Error uploading file' });
  }
});

function zipFolder(folderPath, zipPath) {
  return new Promise((resolve, reject) => {
      const child = fork('./utils/zipFolder.js'); 
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

app.get('/api/v1/user/space/download', authenticate, async (req, res) => {
  const { itemName } = req.query;
  
  if (!itemName) {
    return res.status(400).send({ message: 'Item name is required' });
  }

  try {
    
    const file = await getFile(req.userId, itemName); 
    if (!file) {
      return res.status(404).send({ message: 'File not found' });
    }
    
    
    res.download(file.path, file.name); 
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});

app.get('/api/v1/user/space/download/:fileName', authenticate, async (req, res) => {
  const { fileName } = req.params;
  const compressedFilePath = path.join(DOWNLOADS_DIR, `${fileName}.gz`); 

  try {
    
    const fileExists = await fs.pathExists(compressedFilePath);
    if (!fileExists) {
      return res.status(404).send({ message: 'File not found' });
    }

   
    const readStream = fs.createReadStream(compressedFilePath);
    const unzip = zlib.createGunzip(); 

    
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    readStream.pipe(unzip).pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Error downloading file' });
  }
});




app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
