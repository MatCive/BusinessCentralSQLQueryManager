import { t } from './i18n.js';

/** Error with a translatable message key. */
export class SqmError extends Error {
  constructor(key, params = {}) {
    super(t(key, params));
    this.key = key;
    this.params = params;
  }
}
