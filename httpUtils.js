var http = require('http');
var urllib = require('url');
var qs = require('querystring');
var fs = require('fs');

function respond(resp, code, body) {
	if(Array.isArray(code)) {
		body = code[1];
		code = code[0];
	}
	var headers = { 'Cache-Control': 'no-cache, no-store, must-revalidate, proxy-revalidate', 'Pragma':'no-cache',
		'Access-Control-Allow-Origin':'*' };
	if(typeof body == 'object')
		headers['Content-Type']='application/json';
	console.log('>>', code, body);
	if(code==204) {
		resp.writeHead(code, headers);
		resp.end();
	}
	else if(code==200) {
		resp.writeHead(code, headers);
		resp.end((typeof body == 'object') ? JSON.stringify(body) : body);
	}
	else setTimeout(function() { // thwart brute force attacks
		headers['Content-Type']='application/json';
		resp.writeHead(code, headers);
		resp.end('{"status":'+code+',"error":"'+body+'"}');
	}, 1500); // delay potential denial of service / brute force attacks
}

function serveStatic(resp, path, basePath) {
	var inferMime = function(fname) {
		if(fname.endsWith('manifest.json'))
			return 'application/manifest+json';

		switch(fname.substr(fname.lastIndexOf('.')+1).toLowerCase()) {
		case 'js':
			return 'application/javascript';
		case 'json':
			return 'application/json';
		case 'html':
			return 'text/html';
		case 'txt':
			return 'text/plain';
		case 'css':
			return 'text/css';
		case 'png':
			return 'image/png';
		case 'jpg':
			return 'image/jpg';
		case 'gif':
			return 'image/gif';
		case 'ico':
			return 'image/x-icon';
		case 'svg':
			return 'image/svg+xml';
		case 'appcache':
			return 'text/cache-manifest';
		default:
			return console.log('WARNING mime-type unknown for ',fname);
		}
	}

	if(path.indexOf('..')>=0)
		return respond(resp,403, 'Forbidden');
	if(!basePath)
		basePath = __dirname;
	fs.readFile(basePath + '/'+path, function (err,data) {
		if (err)
			return respond(resp, 404, JSON.stringify(err));
		var headers = { 'Content-Type':inferMime(path) };
		resp.writeHead(200, headers);
		resp.end(data);
	});
}

function parseUrl(url, params) {
	if(typeof(url)=='string')
		url = urllib.parse(url, true);
	if(!Array.isArray(url.path)) {
		url.path = url.pathname.substr(1).split('/');
		if(url.path.length && url.path[url.path.length-1]=='')
			url.path.pop();
	}
	if(params)
		url.query = params;
	for(var key in url.query) {
		var value = url.query[key];
		if(typeof value == 'string' && (value[0]=='{' || value[0]=='[' || value[0]=='"' )) try {
			url.query[key] = JSON.parse(value);
		}
		catch(err) {
			console.error('url query JSON.parse ERROR', err);
		}
	}
	return url;
}

function createServer(ip, port, requestHandler, redirectHandler) {
	var httpServer = http.createServer(function(req, resp) {
		// parse request:
		var params = {};
		var handle = function() {
			var url = parseUrl(req.url, req.method=='POST' ? params : null);
			if('x-forwarded-proto' in req.headers)
				url.protocol = req.headers['x-forwarded-proto'] + ':';
			if('x-forwarded-host' in req.headers)
				url.hostname = req.headers['x-forwarded-host'];
			if('x-forwarded-port' in req.headers)
				url.port = req.headers['x-forwarded-port'];

			if(redirectHandler) {
				redirect = redirectHandler(req, url);
				if(redirect) {
					var code = 302;
					if(typeof redirect=='object') {
						var prot = redirect.protocol ? redirect.protocol : url.protocol ? url.protocol :
							req.connection.encrypted ? 'https:' : 'http:';
						if(prot.slice(-1)!=':')
							prot += ':';
						var hostname = redirect.hostname ? redirect.hostname : url.hostname;
						var port = redirect.port ? redirect.port : (url.port!=80 && url.port!=443) ? url.port : '';
						var pathname = redirect.pathname ? redirect.pathname : redirect.path ?
							('/' + redirect.path.join('/')) : url.pathname;
						var search = redirect.search ? redirect.search :
							redirect.query ? ('?'+qs.stringify(redirect.query)) : url.search;
						var u = '';
						if(hostname)
							u += prot + '//' + hostname;
						if(port) {
							if(!u.length)
								return respond(resp, 500, 'port redirect requires hostname');
							u += ':' + port;
						}
						u += pathname;
						if(search)
							u += search; 
						if(url.hash)
							u += url.hash;
						if('code' in redirect)
							code = redirect.code;
						redirect = u;
					}
					console.log(req.url,'--', code, '->', redirect);
					resp.writeHead(code, { 'Location': redirect });
					return resp.end();
				}
			}

			var remoteAddress = ('x-forwarded-for' in req.headers) ? req.headers['x-forwarded-for'] : req.connection.remoteAddress;
			console.log(req.method, url.pathname, JSON.stringify(url.query));
			return requestHandler(req, resp, url, remoteAddress);
		}
		if(req.method!='POST')
			return handle();
		var body = '';
		req.on('data', function (data) {
			body += data;
			if (body.length > 1e6) { // avoid flood attack
				resp.writeHead(413, {'Content-Type': 'text/plain'}).end();
				req.connection.destroy();
			}
		});
		req.on('end', function () {
			params = qs.parse(body);
			handle();
		});
	});
	httpServer.listen(port, ip);
	console.log('Server listening at', ip+':'+port);
	return httpServer;
}

function parseArgs(args, settings) {
	function err() {
		console.error('ERROR arguments expected  as --arg1 value1 --argn value_n...');
		return false;
	}

	if(!args.length)
		return true;

	for(var i=0; i+1<args.length; i+=2) {
		if(args[i].substr(0,2)!='--')
			return err();
		var key = args[i].substr(2), value=args[i+1];
		if(!(key in settings))
			console.warn('WARNING ignoring unrecognized argument key', key);
		else
			settings[key]=value;
	}
	return true;
}


function onShutdown(callback) {
	var shutdown = function() {
		if(callback)
			callback();
		process.exit();
	}
	process.on( 'SIGINT', shutdown);
	process.on( 'SIGTERM', shutdown);
}

function onInfo(callback) {
	process.on( 'SIGUSR2', callback);
}

module.exports = {
	respond: respond,
	serveStatic: serveStatic,
	createServer: createServer,
	parseArgs: parseArgs,
	parseUrl: parseUrl,
	onShutdown: onShutdown,
	onInfo: onInfo
}
