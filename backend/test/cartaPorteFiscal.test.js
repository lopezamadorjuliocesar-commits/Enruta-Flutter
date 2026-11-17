const test = require('node:test');
const assert = require('node:assert/strict');
const { stampCartaPorte, validateCartaPorteSubmission } = require('../src/carta-porte-fiscal');

const validSubmission = {
  folio: 'CP-1',
  idCcp: 'CCC12345-1234-4234-8234-123456789012',
  data: { tipo: 'T' },
  xml: '<?xml version="1.0"?><cfdi:Comprobante><cartaporte31:CartaPorte IdCCP="CCC12345-1234-4234-8234-123456789012"/></cfdi:Comprobante>',
};

test('accepts a generated Carta Porte submission', () => {
  assert.deepEqual(validateCartaPorteSubmission(validSubmission), []);
});

test('rejects invalid IdCCP, XML declarations and oversized XML', () => {
  assert.ok(validateCartaPorteSubmission({ ...validSubmission, idCcp: 'invalid' }).some((error) => error.includes('IdCCP')));
  assert.ok(validateCartaPorteSubmission({ ...validSubmission, xml: '<!DOCTYPE x><x/>' }).some((error) => error.includes('XML')));
  assert.ok(validateCartaPorteSubmission({ ...validSubmission, xml: 'x'.repeat(900_001) }).some((error) => error.includes('exceder')));
});

test('requires document data and a CFDI type supported by Carta Porte', () => {
  assert.ok(validateCartaPorteSubmission({ ...validSubmission, data: { tipo: 'E' } }).some((error) => error.includes('datos')));
  assert.ok(validateCartaPorteSubmission(null).length > 0);
});

test('sandbox does not claim that a Carta Porte was stamped', async () => {
  const previousMode = process.env.PAC_MODE;
  process.env.PAC_MODE = 'sandbox';
  try {
    const result = await stampCartaPorte({});
    assert.equal(result.status, 'Simulado');
    assert.equal(result.uuid, undefined);
    assert.match(result.message, /no fue timbrado/);
  } finally {
    if (previousMode === undefined) delete process.env.PAC_MODE;
    else process.env.PAC_MODE = previousMode;
  }
});

test('live mode sends the Carta Porte to the PAC and stores its stamped response', async () => {
  const previousMode = process.env.PAC_MODE;
  const previousUrl = process.env.PAC_API_URL;
  const previousToken = process.env.PAC_API_TOKEN;
  const previousFetch = global.fetch;
  process.env.PAC_MODE = 'live';
  process.env.PAC_API_URL = 'https://pac.example.test/stamp';
  process.env.PAC_API_TOKEN = 'test-token';
  global.fetch = async (url, options) => {
    assert.equal(url, process.env.PAC_API_URL);
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    const body = JSON.parse(options.body);
    assert.equal(body.folio, 'CP-1');
    assert.equal(body.idCcp, validSubmission.idCcp);
    return {
      ok: true,
      json: async () => ({
        uuid: '4a8f3d9b-24d5-4d08-9cb4-57448c6bc004',
        xml: '<cfdi:Comprobante><cfdi:Complemento><tfd:TimbreFiscalDigital UUID="4a8f3d9b-24d5-4d08-9cb4-57448c6bc004"/></cfdi:Complemento></cfdi:Comprobante>',
      }),
    };
  };
  try {
    const result = await stampCartaPorte({
      folio: validSubmission.folio,
      id_ccp: validSubmission.idCcp,
      document_data: validSubmission.data,
      xml_content: validSubmission.xml,
    });
    assert.equal(result.status, 'Timbrado');
    assert.equal(result.uuid, '4a8f3d9b-24d5-4d08-9cb4-57448c6bc004');
    assert.match(result.stampedXml, /TimbreFiscalDigital/);
  } finally {
    global.fetch = previousFetch;
    if (previousMode === undefined) delete process.env.PAC_MODE;
    else process.env.PAC_MODE = previousMode;
    if (previousUrl === undefined) delete process.env.PAC_API_URL;
    else process.env.PAC_API_URL = previousUrl;
    if (previousToken === undefined) delete process.env.PAC_API_TOKEN;
    else process.env.PAC_API_TOKEN = previousToken;
  }
});
