/**
 * @fileoverview Fetches Arnie quotes from URLs using the challenge mock HTTP
 * client and maps each response to a quote or failure object.
 */

const { httpGet } = require('./mock-http-interface');

/**
 * Best-effort read of `message` from a JSON response body string.
 * Returns an empty string when the body cannot be parsed or has no usable `message`.
 *
 * @param {unknown} body
 * @returns {string}
 */
function extractMessage(body) {
  if (body == null || typeof body !== 'string') {
    return '';
  }
  try {
    // based on the test cases, we can expect the body to be a valid JSON string
    const parsed = JSON.parse(body);

    const raw = parsed?.message;
    if (raw === undefined || raw === null) {
      return '';
    }
    return typeof raw === 'string' ? raw : String(raw);
  } catch (error) {
    console.error(`[extractMessage] error parsing response body. body: ${body}`, error);
    return '';
  }
}

/**
 * Maps one mocked HTTP response to the challenge result shape.
 * `{ 'FAILURE': … }` is used only when the HTTP status is not 200 (per requirements).
 *
 * @param {{ status: number, body: string }} response Parsed HTTP response from `httpGet`.
 * @returns {{ 'Arnie Quote': string } | { 'FAILURE': string }} Quote on 200, otherwise failure.
 */
function responseToResult(response) {
  const message = extractMessage(response?.body);
  const isSuccess = Number(response?.status) === 200;

  if (isSuccess) {
    return { 'Arnie Quote': message };
  }
  return { FAILURE: message };
}

/** Default cap on simultaneous in-flight requests when fetching many URLs. */
const DEFAULT_CONCURRENCY = 10;

/**
 * Runs `mapper` over `items` with at most `concurrency` async operations in flight.
 * Results are stored by index so output order matches `items` even though work finishes out of order.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} mapper
 * @returns {Promise<R[]>}
 */
async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  // Shared cursor: each worker grabs the next index synchronously, then awaits mapper (no race on `next`).
  let next = 0;

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) {
        return;
      }
      // Write by `index` so `results` ends up aligned with `items` regardless of completion order.
      results[index] = await mapper(items[index], index);
    }
  }

  // No need to spawn more workers than items or than the concurrency budget.
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Executes a HTTP GET request on each of the URLs, transforms each of the HTTP
 * responses according to the challenge instructions and returns the results.
 *
 * Uses a bounded worker pool so large URL lists do not open unbounded concurrent connections.
 *
 * @param {string[]} urls The urls to be requested.
 * @param {number} [concurrency=DEFAULT_CONCURRENCY] Max simultaneous `httpGet` calls.
 * @returns {Promise<Array<{ 'Arnie Quote': string } | { 'FAILURE': string }>>}
 *   A promise which resolves to a results array in the same order as `urls`.
 */
const getArnieQuotes = async (urls, concurrency = DEFAULT_CONCURRENCY) => {
  const limit = Math.max(1, concurrency);

  return mapWithConcurrency(urls, limit, async (url) => {
    try {
      const response = await httpGet(url);
      return responseToResult(response);
    } catch (error) {
      console.error(`[getArnieQuotes] error calling httpGet for URL: ${url}`, error);
      // based on the requirements, it's not 100% clear what to do in this case,
      // so we'll return a FAILURE with the error message
      return { FAILURE: error instanceof Error ? error.message : String(error) };
    }
  });
};

module.exports = {
  getArnieQuotes,
};
