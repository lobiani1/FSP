const express = require('express');
const multer = require('multer');
const { verifyToken } = require('./utils/auth');
const { initStorage, createItem, listUserItems, deleteItem, uploadFile, attachMetadata, getMetadata  } = require('./utils/storage');

const app = express();
const upload = multer();
app.use(express.json());
const PORT = 3000;

initStorage();

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
    await uploadFile(req.userId, file.buffer, fileName);
    res.status(201).send({ message: 'File uploaded successfully' });
  } catch (err) {
    res.status(400).send({ message: err.message });
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


// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
