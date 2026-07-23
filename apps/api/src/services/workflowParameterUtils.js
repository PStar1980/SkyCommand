function isBlankValue(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

module.exports = {
  isBlankValue,
};
