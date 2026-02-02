// Debug logger - only logs in development mode
const isDev = process.env.NODE_ENV !== "production";

export const debug = {
  log: (...args) => isDev && console.log(...args),
  warn: (...args) => isDev && console.warn(...args),
  error: (...args) => console.error(...args), // always log errors
};

export default debug;
