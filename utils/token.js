const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET ;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ;
const TEMP_TOKEN_EXPIRES_IN = '2m'; // 1 min for OTP

const generateToken = (payload, expiresIn = JWT_EXPIRES_IN) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
};

const generateTempToken = (payload) => {
  return generateToken(payload, TEMP_TOKEN_EXPIRES_IN);
};

const verifyTempToken = (token) => jwt.verify(token, JWT_SECRET);

module.exports = { generateToken, generateTempToken, verifyTempToken };
