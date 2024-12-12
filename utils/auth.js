const jwt = require('jsonwebtoken');
const SECRET_KEY = 'your_secret_key'; // Replace with a secure key

// Generate JWT
function generateToken(payload) {
  return jwt.sign(payload, SECRET_KEY, { expiresIn: '1h' });
}

// Verify JWT
function verifyToken(token) {
  return jwt.verify(token, SECRET_KEY);
}

module.exports = { generateToken, verifyToken };
