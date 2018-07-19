const http = require('http');
const https = require('https');
const urllib = require('url');
const qs = require('querystring');
const fs = require('fs');

let jsonLenMax = 1024*100;
let bodyLenMax = 1024*500;

function respond(resp, code, body) {
	if(Array.isArray(code)) {
		body = code[1];
		code = code[0];
	}
	let headers = { 'Cache-Control': 'no-cache, no-store, must-revalidate, proxy-revalidate', 'Pragma':'no-cache',
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
	else setTimeout(()=>{ // thwart brute force attacks
		headers['Content-Type']='application/json';
		resp.writeHead(code, headers);
		resp.end('{"status":'+code+',"error":"'+body+'"}');
	}, 1500); // delay potential denial of service / brute force attacks
	return true;
}

function serveStatic(resp, path, basePath) {
	const inferMime = function(fname) {
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
			console.warn('mime-type unknown for ',fname);
			return 'text/plain';
		}
	}

	if(path.indexOf('..')>=0)
		return respond(resp,403, 'Forbidden');
	if(!basePath)
		basePath = __dirname;
	fs.readFile(basePath + '/'+path, (err,data)=>{
		if (err)
			return respond(resp, 404, JSON.stringify(err));

		let mime = inferMime(path);
		let headers = { 'Content-Type':mime };
		if(mime.startsWith('image/'))
			headers['Cache-Control'] = 'public, max-age=31536000'; // 1year
		resp.writeHead(200, headers);
		resp.end(data);
	});
	return true;
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
	for(let key in url.query) {
		let value = url.query[key];
		if(typeof value == 'string' && (value[0]=='{' || value[0]=='[' || value[0]=='"' ) && value.length<=jsonLenMax) try {
			url.query[key] = JSON.parse(value);
		}
		catch(err) {
			console.error('url query JSON.parse ERROR', err);
		}
	}
	return url;
}

function redirect(req, resp, url, loc) {
	if(!loc)
		return false;
	let code = 302;
	if(typeof loc=='object') {
		let prot = loc.protocol ? loc.protocol : url.protocol ? url.protocol :
			req.connection.encrypted ? 'https:' : 'http:';
		if(prot.slice(-1)!=':')
			prot += ':';
		let hostname = loc.hostname ? loc.hostname :
			url.hostname ? url.hostname : req.headers.host;
		let port = loc.port ? loc.port : (url.port!=80 && url.port!=443) ? url.port : '';
		let pathname = loc.pathname ? loc.pathname : loc.path ?
			('/' + loc.path.join('/')) : url.pathname;
		let search = loc.search ? loc.search :
			loc.query ? ('?'+qs.stringify(loc.query)) : url.search;
		let u = '';
		if(hostname || prot || port)
			u = prot + '//' + hostname;
		if(port)
			u += ':' + port;
		u += pathname;
		if(search)
			u += search; 
		if(url.hash)
			u += url.hash;
		if('code' in loc)
			code = loc.code;
		loc = u;
	}
	console.log(req.method, req.url,'--', code, '-->', loc);
	resp.writeHead(code, { 'Location': loc });
	resp.end();
	return true;
}

function createServer(cfg, handlers) {
	if(typeof handlers === 'function')
		handlers = [ handlers ];

	let handler = function(req, resp) {
		// parse request:
		let params = {};
		let handle = function() {
			let url = parseUrl(req.url, req.method=='POST' ? params : null);
			if('x-forwarded-proto' in req.headers)
				url.protocol = req.headers['x-forwarded-proto'] + ':';
			if('x-forwarded-host' in req.headers)
				url.hostname = req.headers['x-forwarded-host'];
			if('x-forwarded-port' in req.headers)
				url.port = req.headers['x-forwarded-port'];

			for(let i=0, end=handlers.length; i!=end; ++i)
				if(handlers[i](req, resp, url))
					return;
			respond(resp, 404, "Not Found");
		}
		if(req.method!='POST')
			return handle();
		let body = '';
		req.on('data', (data)=>{
			body += data;
			if (body.length > bodyLenMax) { // avoid flood attack
				resp.writeHead(413, {'Content-Type': 'text/plain'}).end();
				req.connection.destroy();
			}
		});
		req.on('end', ()=>{
			params = qs.parse(body);
			handle();
		});
	}

	let ip = cfg.ip || '0.0.0.0';
	let port = cfg.port || (cfg.sslPath ? 443 : 80);
	if('jsonLenMax' in cfg)
		jsonLenMax = cfg.jsonLenMax;
	if('bodyLenMax' in cfg)
		bodyLenMax = cfg.bodyLenMax;

	let server = cfg.sslPath
		? https.createServer({
			key: fs.readFileSync(cfg.sslPath + 'privkey.pem'),
			cert: fs.readFileSync(cfg.sslPath + 'fullchain.pem') }, handler)
		: http.createServer(handler);
	server.listen(port, ip);
	console.log(cfg.sslPath ? 'https':'http','server listening at', ip+':'+port);
	server.isHttps = cfg.sslPath ? true : false;
	return server;
}

function parseArgs(args, settings) {
	if(!args.length)
		return true;

	for(let i=0; i+1<args.length; i+=2) {
		if(args[i].substr(0,2)!='--') {
			console.error('ERROR arguments expected  as --arg1 value1 --argn value_n...');
			return false;
		}
		let key = args[i].substr(2), value=args[i+1];
		if(!(key in settings))
			console.warn('WARNING ignoring unrecognized argument key', key);
		else
			settings[key]=value;
	}
	return true;
}

function onShutdown(callback) {
	const shutdown = function() {
		if(callback)
			callback();
		process.exit();
	}
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}

module.exports = {
	respond: respond,
	serveStatic: serveStatic,
	createServer: createServer,
	redirect: redirect,
	parseArgs: parseArgs,
	parseUrl: parseUrl,
	onShutdown: onShutdown
}
