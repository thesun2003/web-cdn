var WebTorrent = require('webtorrent');
var queryString = require('query-string');
var sha = require('simple-sha1');
var Buffer = require('safe-buffer').Buffer;
var $ = require('jquery');

var opts = {
  maxConns: 5,        // Max number of connections per torrent (default=55)
  tracker: true, // Enable trackers (default=true), or options object for Tracker
  dht: true,     // Enable DHT (default=true), or options object for DHT
  webSeeds: true        // Enable BEP19 web seeds (default=true)
};
var client = new WebTorrent(opts);

client.on('update', function (data) {
  console.log('got an announce response from tracker: ' + data.announce)
  console.log('number of seeders in the swarm: ' + data.complete)
  console.log('number of leechers in the swarm: ' + data.incomplete)
});

client.on('scrape', function (data) {
  console.log('got a scrape response from tracker: ' + data.announce)
  console.log('number of seeders in the swarm: ' + data.complete)
  console.log('number of leechers in the swarm: ' + data.incomplete)
  console.log('number of total downloads of this torrent: ' + data.downloaded)
});

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

  [ 'wss://tracker.btorrent.xyz' ],
  [ 'wss://tracker.fastcast.nz'],
  [ 'wss://tracker.openwebtorrent.com' ],
];
var seeding_list = {};

function get_magnet_uri(full_url, url_hash) {
	var magnet = 'magnet:?xt=urn:btih:' + url_hash + '&dn=' + encodeURIComponent(full_url);
	for (var i=0; i < announceList.length; i++) {
		magnet += '&tr=' + encodeURIComponent(announceList[i][0]);
	}
	magnet += '&ws=' + encodeURIComponent(full_url);
	return magnet;
}

// Human readable bytes util
function prettyBytes(num) {
	var exponent, unit, neg = num < 0, units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
	if (neg) num = -num;
	if (num < 1) return (neg ? '-' : '') + num + ' B';
	exponent = Math.min(Math.floor(Math.log(num) / Math.log(1000)), units.length - 1);
	num = Number((num / Math.pow(1000, exponent)).toFixed(2));
	unit = units[exponent];
	return (neg ? '-' : '') + num + ' ' + unit
}

function show_progress(percent, url_hash) {
	var gradient = 'linear-gradient(to right, #35b44f ' + percent.toString() + '%, transparent 0%, transparent)';
	$('*[hash="'+url_hash+'"]').css('background-image', gradient)
}

// Statistics
function onProgress(torrent) {
	// Torrent
	console.log(torrent.name);
	// Peers
	console.log(torrent.numPeers + (torrent.numPeers === 1 ? ' peer' : ' peers'));

	// Progress
	var percent = Math.round(torrent.progress * 100);
	console.log(percent + '%', prettyBytes(torrent.downloaded), prettyBytes(torrent.length));

	show_progress(percent, torrent.discovery.infoHash);

	// // Remaining time
	// var remaining
	// if (torrent.done) {
	// 	remaining = 'Done.'
	// } else {
	//     remaining = moment.duration(torrent.timeRemaining / 1000, 'seconds').humanize()
	//     remaining = remaining[0].toUpperCase() + remaining.substring(1) + ' remaining.'
	// }
	// $remaining.innerHTML = remaining

	// // Speed rates
	// $downloadSpeed.innerHTML = prettyBytes(torrent.downloadSpeed) + '/s'
	// $uploadSpeed.innerHTML = prettyBytes(torrent.uploadSpeed) + '/s'
}

function render_file(torrent) {
	console.log('Rendering');
	torrent.files.forEach(function (file) {
		// console.log('Render file: ', file);
		// console.log(torrent.discovery.infoHash)

    	// file.getBlob(function callback (err, blob) {
    	// 	 console.log(blob);
    	// })

    	// file.getBlobURL(function callback (err, url) {
    	// 	 console.log(url);
    	// })

     	// file.getBuffer(function (err, buffer) {
     	// 	 if (err) return log(err.message)
     	//   // var got_page = JSON.parse(b.toString('utf8'));
     	//   console.log(buffer);        	
     	//   // console.log('message', "Got cached version of "+got_page.url+" from web peer, checking security hash.")
    	// });

		file.renderTo('*[hash="'+torrent.discovery.infoHash+'"]', function (err, elem) {
		    if (err) throw err // file failed to download or display in the DOM
		});

    });
}

function onTorrentDownloading(torrent) {
	setInterval(function () { onProgress(torrent); }, 500);
    // console.log(torrent);

    render_file(torrent);

    torrent.on('done', function (info) {
      console.log('webtorrent', 'File received')
    })
    torrent.on('download', function (bytes) {
      onProgress(torrent);
      console.log('webtorrent', 'Receiving file ('+bytes+' bytes)')
    })
    torrent.on('wire', function (wire) {
      console.log('webtorrent', 'Peer ('+wire.remoteAddress+') connected over '+wire.type+' (Connection ID: '+wire.peerId.substr(0,10)+').')
    })
}

function get_full_url(url) {
	return location.protocol + '//' + location.host + url;
}

function find_seeds(full_url) {
	console.log('Searching', full_url);

	sha(full_url, function(url_hash){
	    var magnet = get_magnet_uri(full_url, url_hash);

	    console.log('Searching', magnet);

	    var torrent = client.add(magnet, onTorrentDownloading);

		torrent.on('noPeers', function (announceType) {
			console.log('no peers found', announceType);

			const parsed = queryString.parse(location.search);

			if (typeof parsed['seed'] != "undefined") {
				torrent.destroy();
				start_seeding(full_url);
			}

		})
	});
}

function seeding(data, full_url) {
	sha(full_url, function(url_hash){
		sha(data, function (page_hash) {
		    // var payload = { date: new Date(), page: data, page_hash: page_hash, url: full_url }
		    // var payload = data;
		    // var buffer_payload = Buffer.from(JSON.stringify(payload), 'utf8')

		    var buffer_payload = Buffer.from(data, 'binary');

		    console.log('ready');

		    var torrent = client.seed(buffer_payload, {forced_id: url_hash, announceList: announceList, name: full_url}, function(torrent) {
		        console.log('Sending', torrent.magnetURI);

				render_file(torrent);

		        seeding_list[full_url] = 'seeding';

		        torrent.on('upload', function (bytes) {
		          console.log('webtorrent', 'Sending this page to peer ('+bytes+' bytes)')
		        })
		        torrent.on('wire', function (wire) {
		          console.log('webtorrent', 'Peer ('+wire.remoteAddress+') connected over '+wire.type+'.')
		        })
		    });
		});
	});
}

function start_seeding(full_url) {
	if (typeof seeding_list[full_url] != "undefined") return 0;

	console.log('Sending', full_url);

	var oReq = new XMLHttpRequest();
	oReq.open("GET", full_url, true);
	oReq.responseType = "arraybuffer";

	oReq.onload = function(oEvent) {
	  	var data = oReq.response;
	 	seeding(data, full_url);
	};

	oReq.send();
}

function search_webcdn_resources() {
	// search for images
	$('img[webcdn-src]').each(function (id, item) {
		var src = $(item).attr('webcdn-src');
		var full_url = get_full_url(src);

		sha(full_url, function(url_hash){
			$(item).attr('hash', url_hash);
		});

		find_seeds(full_url);
	});
}

$(document).ready(function(){
	search_webcdn_resources();
});