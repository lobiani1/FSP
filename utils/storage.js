const fs = require('fs-extra');
const path = require('path');

const USERS_DIR = path.join(__dirname, '../users');
const META_FILE = 'metadata.json';


async function initStorage() {
  await fs.ensureDir(USERS_DIR);
}


function getUserDir(userId) {
  return path.join(USERS_DIR, userId);
}


async function createItem(userId, itemName, isFolder = true) {
  const userDir = getUserDir(userId);
  const itemPath = path.join(userDir, itemName);

  if (await fs.pathExists(itemPath)) {
    throw new Error('Item already exists');
  }

  if (isFolder) {
    await fs.ensureDir(itemPath);
  } else {
    await fs.ensureFile(itemPath);
  }
}


async function listUserItems(userId) {
  const userDir = getUserDir(userId);
  if (!(await fs.pathExists(userDir))) {
    throw new Error('User space not found');
  }

  const traverse = async (dir) => {
    const items = await fs.readdir(dir, { withFileTypes: true });
    return Promise.all(
      items.map(async (item) => {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          return { name: item.name, type: 'folder', children: await traverse(fullPath) };
        }
        return { name: item.name, type: 'file' };
      })
    );
  };

  return traverse(userDir);
}

async function deleteItem(userId, itemName) {
  const userDir = getUserDir(userId);
  const itemPath = path.join(userDir, itemName);

  if (!(await fs.pathExists(itemPath))) {
    throw new Error('Item not found');
  }

  const stats = await fs.lstat(itemPath);
  if (stats.isDirectory()) {
    const contents = await fs.readdir(itemPath);
    if (contents.length > 0) {
      throw new Error('Folder is not empty');
    }
    await fs.remove(itemPath);
  } else {
    await fs.remove(itemPath);
  }
}


async function saveUser(userId, data) {
  const filePath = path.join(USERS_DIR, `user_${userId}.json`);
  await fs.writeJson(filePath, data);
}

async function getUser(userId) {
  const filePath = path.join(USERS_DIR, `user_${userId}.json`);
  if (await fs.pathExists(filePath)) {
    return fs.readJson(filePath);
  }
  return null;
}


async function deleteUser(userId) {
  const filePath = path.join(USERS_DIR, `user_${userId}.json`);
  if (await fs.pathExists(filePath)) {
    await fs.remove(filePath);
  }
}


async function uploadFile(userId, file, fileName) {
  const userDir = path.join(USERS_DIR, userId);
  const filePath = path.join(userDir, fileName);

  if (!(await fs.pathExists(userDir))) {
    throw new Error('User space not found');
  }

  await fs.writeFile(filePath, file);
}


async function attachMetadata(userId, itemName, metadata) {
  const userDir = path.join(USERS_DIR, userId);
  const itemPath = path.join(userDir, itemName);
  const metaPath = path.join(userDir, META_FILE);

  if (!(await fs.pathExists(itemPath))) {
    throw new Error('Item not found');
  }

  let meta = {};
  if (await fs.pathExists(metaPath)) {
    meta = await fs.readJson(metaPath);
  }

  meta[itemName] = metadata;
  await fs.writeJson(metaPath, meta, { spaces: 2 });
}


async function getMetadata(userId, itemName) {
  const userDir = path.join(USERS_DIR, userId);
  const metaPath = path.join(userDir, META_FILE);

  if (!(await fs.pathExists(metaPath))) {
    throw new Error('No metadata found');
  }

  const meta = await fs.readJson(metaPath);
  if (!meta[itemName]) {
    throw new Error('No metadata for the specified item');
  }

  return meta[itemName];
}


async function getFile(userId, itemName) {
  const userDir = getUserDir(userId);
  const filePath = path.join(userDir, itemName);

  
  if (!(await fs.pathExists(filePath))) {
    throw new Error('File not found');
  }

  return {
    path: filePath,
    name: itemName
  };
}




module.exports = { 
  initStorage, 
  saveUser, 
  getUser, 
  deleteUser, 
  createItem, 
  listUserItems, 
  deleteItem, 
  uploadFile, 
  attachMetadata, 
  getMetadata, 
  getFile
};
