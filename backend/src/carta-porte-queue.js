const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const pool = require('./db');
const { stampCartaPorte } = require('./carta-porte-fiscal');

const QUEUE_NAME = 'cola-carta-porte';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let connection;
let queue;
let worker;

function getConnection() {
  if (!connection) {
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
    connection.on('error', (error) => console.error('Error de conexión con Redis:', error.message));
  }
  return connection;
}

function initCartaPorteQueue() {
  if (worker) return;

  const redis = getConnection();
  queue = new Queue(QUEUE_NAME, {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  });
  worker = new Worker(QUEUE_NAME, async (job) => {
    const { documentId, company } = job.data;
    await pool.query(
      `UPDATE carta_porte_documents
       SET status='Procesando', attempts=attempts+1, error_message=NULL, updated_at=now()
       WHERE id=$1 AND company=$2`,
      [documentId, company]
    );

    try {
      const { rows } = await pool.query(
        'SELECT * FROM carta_porte_documents WHERE id=$1 AND company=$2',
        [documentId, company]
      );
      if (!rows[0]) throw new Error('Documento de Carta Porte no encontrado.');

      const result = await stampCartaPorte(rows[0]);
      const stamped = await pool.query(
        `UPDATE carta_porte_documents
         SET status=$3, pac_uuid=$4, stamped_xml=$5, pac_stamped_at=$6,
             error_message=NULL, updated_at=now()
         WHERE id=$1 AND company=$2`,
        [
          documentId,
          company,
          result.status,
          result.uuid || null,
          result.stampedXml || null,
          result.stampedAt || null,
        ]
      );
      if (!stamped.rowCount) throw new Error('No se pudo actualizar el estado de la Carta Porte.');
      return { status: result.status, message: result.message };
    } catch (error) {
      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts || 1);
      await pool.query(
        `UPDATE carta_porte_documents
         SET status=$3, error_message=$4, updated_at=now()
         WHERE id=$1 AND company=$2`,
        [documentId, company, finalAttempt ? 'Error' : 'EnCola', error.message]
      );
      throw error;
    }
  }, { connection: redis, concurrency: 3 });
  worker.on('error', (error) => console.error('Error en la cola de Carta Porte:', error.message));
}

async function enqueueCartaPorte(documentId, company) {
  if (!queue) throw new Error('La cola de Carta Porte no está inicializada.');
  return queue.add(
    'TIMBRAR_CARTA_PORTE',
    { documentId, company },
    { jobId: `${documentId}-${Date.now()}` }
  );
}

module.exports = { QUEUE_NAME, enqueueCartaPorte, initCartaPorteQueue };
