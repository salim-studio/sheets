// The suite's expectations are written in American English. Pin the default locale so the
// number and date text a dialog shows does not depend on the machine running the tests.
const numberToString = Number.prototype.toLocaleString;
Number.prototype.toLocaleString = function (locales, options) {
  return numberToString.call(this, locales ?? 'en-US', options);
};
const dateToString = Date.prototype.toLocaleString;
Date.prototype.toLocaleString = function (locales, options) {
  return dateToString.call(this, locales ?? 'en-US', options);
};
