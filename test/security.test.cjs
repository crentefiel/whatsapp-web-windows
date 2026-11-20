'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isWhatsAppOrigin, isSafeExternalLink,
  cleanDownloadFilename, chromiumUserAgent,
} = require('../src/security.cjs');

test('permite exclusivamente origem oficial do WhatsApp Web', () => {
  assert.equal(isWhatsAppOrigin('https://web.whatsapp.com/'), true);
  assert.equal(isWhatsAppOrigin('https://web.whatsapp.com/path'), true);
  for (const url of [
    'http://web.whatsapp.com/',
    'https://web.whatsapp.com.evil.invalid/',
    'https://evil.invalid/',
    'file:///C:/x', 'javascript:alert(1)', 'not-a-url',
  ]) assert.equal(isWhatsAppOrigin(url), false, url);
});

test('somente links externos web seguros, sem protocolos locais', () => {
  assert.equal(isSafeExternalLink('https://example.com/help'), true);
  for (const url of ['file:///etc/passwd','javascript:alert(1)','http://localhost:3000','http://127.0.0.1:3000','ftp://host/', 'https://user:pass@example.com']) {
    assert.equal(isSafeExternalLink(url), false, url);
  }
});

test('limpa nomes de anexos', () => {
  assert.equal(cleanDownloadFilename('a:b\\c?.pdf'), 'a_b_c_.pdf');
  assert.equal(cleanDownloadFilename('..'), 'arquivo');
  assert.ok(cleanDownloadFilename('x'.repeat(300)).length <= 180);
});

test('remove token Electron e mantém o navegador Chromium', () => {
  assert.equal(chromiumUserAgent('Mozilla Chrome/156.0 Electron/45.4.1 Safari/537.36'), 'Mozilla Chrome/156.0 Safari/537.36');
});
