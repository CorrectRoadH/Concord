import { readFileSync, unwatchFile, watchFile, writeFileSync } from 'node:fs';
import { Server } from 'node:net';

const record = process.env.CONCORD_TEST_LISTENER_RECORD;
const boundary = process.env.CONCORD_TEST_LISTENER_CLOSE;
const release = process.env.CONCORD_TEST_LISTENER_RELEASE;
if (record && boundary && release) {
  const close = Server.prototype.close;
  Server.prototype.close = function(callback) {
    if (typeof this.address() !== 'string') return close.call(this, callback);
    writeFileSync(boundary, readFileSync(record));
    if (!callback) return close.call(this);
    return close.call(this, error => {
      watchFile(release, { persistent: false, interval: 20 }, stat => {
        if (stat.size === 0) return;
        unwatchFile(release);
        callback(error);
      });
    });
  };
}
