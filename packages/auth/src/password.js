const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const DEFAULT_BCRYPT_ROUNDS = Number(process.env.AUTH_BCRYPT_ROUNDS || 12);

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Password must be at least 12 characters long.');
  }
}

async function hashPassword(password) {
  validatePassword(password);
  return bcrypt.hash(password, DEFAULT_BCRYPT_ROUNDS);
}

async function verifyPassword(password, passwordHash) {
  if (!password || !passwordHash) {
    return false;
  }

  return bcrypt.compare(password, passwordHash);
}

function createSessionToken() {
  return crypto.randomBytes(48).toString('base64url');
}

function hashToken(token) {
  if (!token) {
    throw new Error('Token is required.');
  }

  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSessionToken,
  hashToken,
};
