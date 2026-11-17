const XML_LIMIT = 900_000;
const ID_CCP_RE = /^CCC[A-F0-9]{5}-[A-F0-9]{4}-4[A-F0-9]{3}-[89AB][A-F0-9]{3}-[A-F0-9]{12}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateCartaPorteSubmission(body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return ['El documento de Carta Porte es obligatorio.'];
  }

  if (typeof body.folio !== 'string' || !body.folio.trim() || body.folio.length > 100) {
    errors.push('El folio es obligatorio y no debe exceder 100 caracteres.');
  }
  if (typeof body.idCcp !== 'string' || !ID_CCP_RE.test(body.idCcp)) {
    errors.push('El IdCCP no tiene un formato válido.');
  }
  if (!body.data || typeof body.data !== 'object' || !['I', 'T'].includes(body.data.tipo)) {
    errors.push('Los datos del CFDI de Carta Porte no son válidos.');
  }
  if (typeof body.xml !== 'string' || !body.xml.trim() || body.xml.length > XML_LIMIT) {
    errors.push(`El XML es obligatorio y no debe exceder ${XML_LIMIT} caracteres.`);
  } else if (
    !/^\s*<\?xml\b/.test(body.xml) ||
    /<!DOCTYPE|<!ENTITY/i.test(body.xml) ||
    !/<cartaporte31:CartaPorte\b/i.test(body.xml) ||
    !body.xml.toUpperCase().includes(`IDCCP="${String(body.idCcp).toUpperCase()}"`)
  ) {
    errors.push('El XML debe ser un documento XML válido y no puede declarar entidades.');
  }

  return errors;
}

function providerMode() {
  return (process.env.PAC_MODE || 'sandbox').trim().toLowerCase();
}

function validateProviderConfiguration() {
  const mode = providerMode();
  if (mode === 'sandbox') return;
  if (mode !== 'live') throw new Error('PAC_MODE debe ser sandbox o live.');
  if (!process.env.PAC_API_URL || !process.env.PAC_API_TOKEN) {
    throw new Error('Configura PAC_API_URL y PAC_API_TOKEN antes de enviar documentos al PAC.');
  }
}

async function stampCartaPorte(document) {
  const mode = providerMode();
  validateProviderConfiguration();

  if (mode === 'sandbox') {
    return {
      status: 'Simulado',
      message: 'Prueba en sandbox completada. El CFDI no fue timbrado y no tiene validez fiscal.',
    };
  }

  let response;
  try {
    response = await fetch(process.env.PAC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.PAC_API_TOKEN}`,
      },
      body: JSON.stringify({
        folio: document.folio,
        idCcp: document.id_ccp,
        data: document.document_data,
        xml: document.xml_content,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(`No se pudo conectar con el PAC: ${error.message}`);
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('El PAC devolvió una respuesta que no es JSON.');
  }
  if (!response.ok) throw new Error(`El PAC respondió con estado HTTP ${response.status}.`);

  const uuid = result.uuid || result.UUID;
  const stampedXml = result.xml || result.xml_content;
  if (
    typeof uuid !== 'string' ||
    !UUID_RE.test(uuid.trim()) ||
    typeof stampedXml !== 'string' ||
    !/<(?:[A-Za-z_][\w.-]*:)?TimbreFiscalDigital\b/.test(stampedXml) ||
    !stampedXml.toLowerCase().includes(`uuid="${uuid.trim().toLowerCase()}"`)
  ) {
    throw new Error('La respuesta del PAC debe incluir un UUID válido y el XML con su TimbreFiscalDigital.');
  }

  return {
    status: 'Timbrado',
    uuid: uuid.trim(),
    stampedXml,
    stampedAt: result.stampedAt || result.pac_stamped_at || new Date().toISOString(),
    message: 'CFDI timbrado por el PAC.',
  };
}

module.exports = {
  stampCartaPorte,
  validateCartaPorteSubmission,
  validateProviderConfiguration,
};
