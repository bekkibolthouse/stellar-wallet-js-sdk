'use strict';

var crypto  = require("crypto");
var errors = require('../errors');
var nacl = require('tweetnacl');
var sjcl = require('./sjcl');

module.exports = {
  base64_encode: base64_encode,
  calculateMasterKey: calculateMasterKey,
  decryptData: decryptData,
  deriveWalletId: generateDeriveFromKeyFunction('CONST_W'),
  deriveWalletKey: generateDeriveFromKeyFunction('CONST_KW'),
  encryptData: encryptData,
  sha1: makeHasher('sha1'),
  sha256: makeHasher('sha256'),
  signRequest: signRequest
};

function base64_encode(str) {
  return (new Buffer(str)).toString('base64');
}
function base64_decode(str) {
  return (new Buffer(str, 'base64')).toString();
}

function Uint8ArrayFromString(str) {
  var uint = new Uint8Array(str.length);
  for (var i=0,j=str.length; i<j; ++i){
    uint[i] = str.charCodeAt(i);
  }
  return uint;
}

function signRequest(privateKey) {
  return function(request) {
    var walletId = base64_encode(request._data.walletId);
    var serializedData = superagent.serializeObject(request._data);
    var signature = base64_encode(nacl.sign(Uint8ArrayFromString(serializedData), Uint8ArrayFromString('s3tZPX5xE9obmKfR61vJwFVHHwVxG32DwCJb4XyMpC3Rtu4PsgGaaaaaaaaaaaaa')));
    request.set('Authorization', 'STELLAR-WALLET-V2 wallet-id="'+walletId+'", signature="'+signature+'"');
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

  return base64_encode(data);
}

function decryptData(encryptedData, key) {
  var rawCipherText, rawIV, cipherName, modeName;

  try {
    var resultObject = JSON.parse(base64_decode(encryptedData));
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
  var salt = module.exports.sha256(s0+username);

  return sjcl.misc.scrypt(
      password,
      salt,
      kdfParams.n,
      kdfParams.r,
      kdfParams.p,
      kdfParams.bits
  );
}