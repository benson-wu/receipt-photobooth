/**
 * In-process print queue: FIFO, one job at a time, shared by photobooth and missions.
 * Retries once on failure. Logs everything.
 */

let jobIdCounter = 0;
const queue = [];
const jobResults = new Map(); // jobId -> { printed, error }
let processing = false;

function nextId() {
  jobIdCounter += 1;
  return String(jobIdCounter);
}

/**
 * @param {{ type: 'image'|'text', payload: Buffer|string, source: string, meta?: object }} job
 * @returns {{ jobId: string, status: 'queued' }}
 */
function addJob(job) {
  const jobId = nextId();
  const entry = { jobId, ...job, status: "queued", addedAt: new Date().toISOString() };
  queue.push(entry);
  console.log(`[queue] job ${jobId} queued (source=${job.source} type=${job.type}) queue length=${queue.length}`);
  processNext();
  return { jobId, status: "queued" };
}

/**
 * Wait for a job to complete. Resolves with { printed, error }.
 * @param {string} jobId
 * @returns {Promise<{ printed: boolean, error?: string }>}
 */
function waitForJob(jobId) {
  return new Promise((resolve) => {
    const check = () => {
      const r = jobResults.get(jobId);
      if (r !== undefined) {
        jobResults.delete(jobId);
        return resolve(r);
      }
      setTimeout(check, 50);
    };
    check();
  });
}

/**
 * @param {(job: any) => Promise<{ printed: boolean, error?: string }>} processOne - runs one job, returns result
 */
function setProcessor(processOne) {
  processor = processOne;
}

let processor = null;

async function processNext() {
  if (processing || queue.length === 0 || !processor) return;
  processing = true;
  const job = queue.shift();
  job.status = "printing";
  console.log(`[queue] job ${job.jobId} started (source=${job.source})`);

  let result = await processor(job);
  if (!result.printed && result.error) {
    console.warn(`[queue] job ${job.jobId} failed, retrying once:`, result.error);
    result = await processor(job);
  }

  jobResults.set(job.jobId, result);
  if (result.printed) {
    console.log(`[queue] job ${job.jobId} done`);
  } else {
    console.warn(`[queue] job ${job.jobId} failed:`, result.error);
  }
  processing = false;
  if (queue.length > 0) processNext();
}

function getStatus() {
  return { queueLength: queue.length, processing };
}

module.exports = { addJob, waitForJob, setProcessor, getStatus };
