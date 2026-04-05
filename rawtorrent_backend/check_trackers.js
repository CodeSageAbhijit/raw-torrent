const fs = require('fs');
const dgram = require('dgram');

const trackers = [
  'udp://tracker.opentrackr.org:1337',
  'udp://open.stealth.si:80',
  'udp://tracker.torrent.eu.org:451',
  'udp://explodie.org:6969',
  'udp://tracker.tiny-vps.com:6969',
  'udp://exodus.desync.com:6969',
  'udp://9.rarbg.to:2710',
  'udp://tracker.cyberia.is:6969',
  'udp://tracker.openbittorrent.com:80',
  'udp://tracker.publicbt.com:80',
  'udp://tracker.1337x.com:6969',
  'udp://tracker.zer0day.to:1337'
];

async function checkTrackers() {
  const dns = require('dns').promises;
  for (const t of trackers) {
    const url = new URL(t);
    try {
      const res = await dns.resolve(url.hostname);
      console.log([OK DNS]  -> );
    } catch (e) {
      console.log([FAIL DNS]  -> );
    }
  }
}
checkTrackers();
