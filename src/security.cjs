'use strict';

const WHATSAPP_ORIGIN = 'https://web.whatsapp.com';

function isWhatsAppOrigin(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.origin === WHATSAPP_ORIGIN;
  } catch {
    return false;
  }
}

function isSafeExternalLink(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.hostname !== 'localhost' &&
      url.hostname !== '127.0.0.1' &&
      !url.hostname.endsWith('.localhost') &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

function cleanDownloadFilename(rawName) {
  const filename = String(rawName || 'arquivo').replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').trim();
  const normalized = filename.replace(/^\.+/, '').slice(0, 180);
  return normalized || 'arquivo';
}

function chromiumUserAgent(rawUserAgent) {
  return String(rawUserAgent || '').replace(/\sElectron\/\d+(?:\.\d+)*/g, '');
}

module.exports = { WHATSAPP_ORIGIN, isWhatsAppOrigin, isSafeExternalLink, cleanDownloadFilename, chromiumUserAgent };
