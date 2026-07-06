function resolvePersistedRecords(apiRecords, localRecords) {
  if (Array.isArray(apiRecords) && apiRecords.length > 0) {
    return apiRecords;
  }
  if (Array.isArray(localRecords)) {
    return localRecords;
  }
  return [];
}

module.exports = {
  resolvePersistedRecords,
};
