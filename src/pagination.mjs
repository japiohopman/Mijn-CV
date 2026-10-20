/**
 * Fetch all pages from a token-paginated API.
 * Incomplete responses and repeated tokens are hard errors by design.
 */
export async function fetchAllTokenPages(fetchPage, {
  firstPath,
  collectionKey,
  pageSize = 100,
} = {}) {
  if (typeof fetchPage !== 'function') throw new TypeError('fetchPage must be a function');
  if (!firstPath || !collectionKey) throw new TypeError('firstPath and collectionKey are required');
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new TypeError('pageSize must be a positive integer');

  const items = [];
  const seenTokens = new Set();
  let token = null;

  while (true) {
    const separator = firstPath.includes('?') ? '&' : '?';
    const path = token
      ? firstPath + separator + 'pageSize=' + pageSize + '&pageToken=' + encodeURIComponent(token)
      : firstPath + separator + 'pageSize=' + pageSize;
    const payload = await fetchPage(path);

    if (!payload || !Array.isArray(payload[collectionKey])) {
      throw new Error('Incomplete API page: expected array property "' + collectionKey + '" at ' + path);
    }

    items.push(...payload[collectionKey]);
    const nextToken = payload.nextPageToken;
    if (!nextToken) return items;

    if (seenTokens.has(nextToken)) {
      throw new Error('Pagination repeated token: ' + nextToken);
    }
    seenTokens.add(nextToken);
    token = nextToken;
  }
}
