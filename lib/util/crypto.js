'use strict';

var _ = require('lodash');
var base58 = require('bs58');
var crypto  = require("crypto");
var errors = require('../errors');
var nacl = require('tweetnacl');
var sjcl = require('./sjcl');

module.exports = {
  calculateMasterKey: calculateMasterKey,
  bytesToWords: bytesToWords,
  decryptData: decryptData,
  deriveWalletId: generateDeriveFromKeyFunction('WALLET_ID'),
  deriveWalletKey: generateDeriveFromKeyFunction('WALLET_KEY'),
  encryptData: encryptData,
  generateRandomRecoveryCode: generateRandomRecoveryCode,
  sha1: makeHasher('sha1'),
  sha256: makeHasher('sha256'),
  signRequest: signRequest
};

function base64Encode(str) {
  return (new Buffer(str)).toString('base64');
}
function base64Decode(str) {
  return (new Buffer(str, 'base64')).toString();
}

function signRequest(username, walletId, secretKey) {
  return function(request) {
    var rawSecretKey = nacl.util.decodeBase64(secretKey);
    var serializedData = nacl.util.decodeUTF8(JSON.stringify(request._data));
    var signature = nacl.sign.detached(serializedData, rawSecretKey);
    signature = nacl.util.encodeBase64(signature);
    request.set('Authorization', 'STELLAR-WALLET-V2 username="'+username+'", wallet-id="'+walletId+'", signature="'+signature+'"');
  }
}

function makeHasher(algo) {
  return function(value) {
    var hasher = crypto.createHash(algo);
    return hasher.update(value).digest("hex");
  };
}

function generateDeriveFromKeyFunction(token) {
  return function(masterKey) {
    var hmac = new sjcl.misc.hmac(masterKey, sjcl.hash.sha256);
    return hmac.encrypt(token);
  };
}

function encryptData(data, key) {
  if (!_.isString(data)) {
    throw new TypeError('data must be a String.');
  }

  var cipherName = 'aes';
  var modeName = 'gcm';

  var cipher = new sjcl.cipher[cipherName](key);
  var rawIV = sjcl.random.randomWords(3);
  var encryptedData = sjcl.mode[modeName].encrypt(
    cipher,
    sjcl.codec.utf8String.toBits(data),
    rawIV
  );

  data = JSON.stringify({
    IV: sjcl.codec.base64.fromBits(rawIV),
    cipherText: sjcl.codec.base64.fromBits(encryptedData),
    cipherName: cipherName,
    modeName: modeName
  });

  return base64Encode(data);
}

function decryptData(encryptedData, key) {
  var rawCipherText, rawIV, cipherName, modeName;

  try {
    var resultObject = JSON.parse(base64Decode(encryptedData));
    rawIV = sjcl.codec.base64.toBits(resultObject.IV);
    rawCipherText = sjcl.codec.base64.toBits(resultObject.cipherText);
    cipherName = resultObject.cipherName;
    modeName = resultObject.modeName;
  } catch(e) {
    new errors.DataCorrupt();
  }

  var cipher = new sjcl.cipher[cipherName](key);
  var rawData = sjcl.mode[modeName].decrypt(cipher, rawCipherText, rawIV);
  return sjcl.codec.utf8String.fromBits(rawData);
}

function calculateMasterKey(s0, username, password, kdfParams) {
  var versionBits      = sjcl.codec.hex.toBits("0x01");
  var s0Bits           = sjcl.codec.base64.toBits(s0);
  var usernameBits     = sjcl.codec.utf8String.toBits(username);
  var unhashedSaltBits = _.reduce([versionBits, s0Bits, usernameBits], sjcl.bitArray.concat);
  var salt             = sjcl.hash.sha256.hash(unhashedSaltBits);

  return sjcl.misc.scrypt(
    password,
    salt,
    kdfParams.n,
    kdfParams.r,
    kdfParams.p,
    kdfParams.bits / 8
  );
}

function generateRandomRecoveryCode() {
  var rawRecoveryKey = nacl.randomBytes(32);
  return base58.encode(new Buffer(rawRecoveryKey));
}

function bytesToWords(bytes) {
  for (var words = [], i = 0, b = 0; i < bytes.length; i++, b += 8)
    words[b >>> 5] |= bytes[i] << (24 - b % 32);
  return words;
}
