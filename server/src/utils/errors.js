class AppError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new AppError(status, code, message); };
const route = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);
module.exports = { AppError, fail, route };
