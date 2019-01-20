let WebTorrent = require('webtorrent');
let queryString = require('query-string');
let sha = require('simple-sha1');
let Buffer = require('safe-buffer').Buffer;
let $ = require('jquery');

let opts = {
  maxConns: 5,    // Max number of connections per torrent (default=55)
  tracker: true,  // Enable trackers (default=true), or options object for Tracker
  dht: true,      // Enable DHT (default=true), or options object for DHT
  webSeeds: true, // Enable BEP19 web seeds (default=true)
};
let client = new WebTorrent(opts);

var announceList = [
  // [ 'http://localhost:8000/announce'],
  // [ 'udp://0.0.0.0:8000'],
  // [ 'udp://localhost:8000'],
  // [ 'ws://localhost:8000'],
  
  [ 'udp://explodie.org:6969' ],
  [ 'udp://tracker.coppersurfer.tk:6969' ],
  [ 'udp://tracker.empire-js.us:1337' ],
  [ 'udp://tracker.leechers-paradise.org:6969' ],
  [ 'udp://tracker.opentrackr.org:1337' ],

  [ 'udp://tracker.openbittorrent.com:80' ],
  [ 'udp://tracker.internetwarriors.net:1337' ],
  [ 'udp://exodus.desync.com:6969' ],

  // [ 'wss://tracker.btorrent.xyz' ],
  [ 'wss://tracker.fastcast.nz'],
  [ 'wss://tracker.openwebtorrent.com' ],
];
let fileInfo = {};

function getMagnetUri(full_url, url_hash) {
	let magnet = 'magnet:?xt=urn:btih:' + url_hash + '&dn=' + encodeURIComponent(full_url);
	for (let i=0; i < announceList.length; i++) {
		magnet += '&tr=' + encodeURIComponent(announceList[i][0]);
	}
	magnet += '&ws=' + encodeURIComponent(full_url);
    magnet += '&as=' + encodeURIComponent(full_url);
	return magnet;
}

function getFullUrl(url) {
    return location.protocol + '//' + location.host + url;
}

function setFileInfoField(fullUrl, field, value) {
    if (!getFileState(fullUrl)) {
        fileInfo[fullUrl] = {
            'state': null,
            'rendered': null,
        };
    }
    fileInfo[fullUrl][field] = value;
}

function setFileState(fullUrl, state) {
    setFileInfoField(fullUrl, 'state', state);

    if (state === 'rendered') {
        setFileInfoField(fullUrl, 'rendered', true);
    }
}

function getFileInfoField(fullUrl, field) {
    if (fullUrl in fileInfo) {
        return fileInfo[fullUrl][field];
    }

    return null;
}

function getFileState(fullUrl) {
    return getFileInfoField(fullUrl, 'state');
}

function isFileRendered(fullUrl) {
    return getFileInfoField(fullUrl, 'rendered');
}

// Human readable bytes util
function prettyBytes(num) {
	let exponent, unit, neg = num < 0, units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
	if (neg) num = -num;
	if (num < 1) return (neg ? '-' : '') + num + ' B';
	exponent = Math.min(Math.floor(Math.log(num) / Math.log(1000)), units.length - 1);
	num = Number((num / Math.pow(1000, exponent)).toFixed(2));
	unit = units[exponent];
	return (neg ? '-' : '') + num + ' ' + unit
}

function showProgress(percent, url_hash) {
	let gradient = 'linear-gradient(to right, #35b44f ' + percent.toString() + '%, transparent 0%, transparent)';
	$('*[hash="'+url_hash+'"]').css('background-image', gradient)
}

// Statistics
function onProgress(torrent) {
	// Torrent
	console.log(torrent.name);
	// Peers
	console.log(torrent.numPeers + (torrent.numPeers === 1 ? ' peer' : ' peers'));

	// Progress
	let percent = Math.round(torrent.progress * 100);
	console.log(percent + '%', prettyBytes(torrent.downloaded), prettyBytes(torrent.length));

    if (!torrent.done) {
        showProgress(percent, torrent.discovery.infoHash);
    }
}

function getFile(torrent) {
	return torrent.files[0];
}

function renderFile(torrent) {
	let fullUrl = torrent.name;

    if (isFileRendered(fullUrl)) {
    	return 0;
    }

	console.log('Rendering');

    setFileState(fullUrl, 'rendered');

	let file = getFile(torrent);
    file.renderTo('*[hash="'+torrent.discovery.infoHash+'"]', function (err, elem) {
        if (err) throw err; // file failed to download or display in the DOM
    });

}

function onTorrentDownloading(torrent) {
    renderFile(torrent);

    torrent.on('done', function (info) {
      	console.log('webtorrent', 'OTD: File received');
    });

    torrent.on('download', function (bytes) {
      	console.log('webtorrent', 'Receiving file ('+bytes+' bytes)');
        onProgress(torrent);
    });
}

function searchSeeds(fullUrl) {
	console.log('Searching', fullUrl);

    setFileState(fullUrl, 'searching');

	sha(fullUrl, function(urlHash){
	    let magnet = getMagnetUri(fullUrl, urlHash);

	    console.log('Searching', magnet);

	    let torrentD = client.add(magnet, null, onTorrentDownloading);

        torrentD.on('wire', function (wire) {
            console.log('webtorrent', 'FS: Peer ('+wire.remoteAddress+') connected over '+wire.type+' (Connection ID: '+wire.peerId.substr(0,10)+').');
        });

        torrentD.on('noPeers', function (announceType) {
            console.log('no peers found', announceType);

            const parsed = queryString.parse(location.search);

            if ('seed' in parsed) {
                torrentD.destroy();
                startSeeding(fullUrl);
            }

        });

        torrentD.on('done', function (info) {
            console.log('webtorrent', 'FS: File received');

            let file = getFile(torrentD);
			file.getBuffer(function (err, buffer) {
				// data = buffer;

				// console.log(buffer);

				torrentD.destroy();
				seeding(buffer, fullUrl);
			});
        });
	});
}

function seeding(data, fullUrl) {
	sha(fullUrl, function(url_hash){
		let buffer_payload = Buffer.from(data, 'binary');

		console.log('ready');

		client.seed(buffer_payload, {forced_id: url_hash, announceList: announceList, name: fullUrl}, function(torrentU) {
			console.log('Sending', torrentU.magnetURI);

			renderFile(torrentU);

            setFileState(fullUrl, 'seeding');

			torrentU.on('upload', function (bytes) {
			  console.log('webtorrent', 'Sending this page to peer ('+bytes+' bytes)');
			});

			torrentU.on('wire', function (wire) {
			  console.log('webtorrent', 'Peer ('+wire.remoteAddress+') connected over '+wire.type+'.');
			});
		});
	});
}

function startSeeding(fullUrl) {
    if (getFileState(fullUrl) === 'seeding') return 0;

	console.log('Sending', fullUrl);

	let oReq = new XMLHttpRequest();
	oReq.open("GET", fullUrl, true);
	oReq.responseType = "arraybuffer";

	oReq.onload = function(oEvent) {
	  	let data = oReq.response;
	 	seeding(data, fullUrl);
	};

	oReq.send();
}

function searchWebcdnResources() {
	// search for images
	$('img[webcdn-src]').each(function (id, item) {
		var src = $(item).attr('webcdn-src');
		var fullUrl = getFullUrl(src);

		sha(fullUrl, function(urlHash){
			$(item).attr('hash', urlHash);
		});

		searchSeeds(fullUrl);
	});
}

$(document).ready(function(){
	searchWebcdnResources();

    setInterval(function () {
    	console.log(fileInfo);
	}, 500);
});
