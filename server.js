var qs = require('querystring');
var fs = require('fs');

var httpUtils = require('./httpUtils');
var Sim = require('./static/sim');

var cfg = {
	host:process.env.OPENSHIFT_NODEJS_IP || '0.0.0.0',
	port:process.env.OPENSHIFT_NODEJS_PORT || 1771,
	isOpenshift: (process.env.OPENSHIFT_NODEJS_IP!=null),
	devMode: 1
}
httpUtils.parseArgs(process.argv.slice(2), cfg);

//------------------------------------------------------------------

function ServerPelagium(topLevelPath) {

	this.makeid = function(len) {
		var possible = "ABCDEFGHKLMNPQRSTUVWXYZ123456789";
		var valuesPerChar = possible.length;
		do {
			var id = "";
			for( var i=0; i < len; ++i)
				id += possible.charAt(Math.floor(Math.random() * valuesPerChar));
		} while(this.matches.has(id));
		return id;
	}

	this.matchCreate = function(params) {
		var id = params.id = this.makeid(6);
		var sim = new Sim(params);
		if(sim.state!='init')
			return [ 400, 'invalid match parameters' ];
	
		this.matches.set(id, { id:id, sim:sim, users:new Map() });
		return [ 200, { match:id } ];
	}

	this.matchDelete = function(id) {
		var match = this.matches.get(id);
		if(!match)
			return;
		var self = this;
		match.users.forEach(function(value, key) {
			self.matches.delete(key);
		});
		this.matches.delete(match.id);
	}

	this.userCreate = function(match, params) {
		var numPlayersMax = 2;
		var numPlayers = match.users.size;
		if(numPlayers >= numPlayersMax)
			return [ 403, 'Additional players forbidden'];

		var user = { party: match.users.size + 1 };
		user.id = this.makeid(6); 
		if(params.name)
			user.name = params.name;
		if(params.email)
			user.email = params.email;
		match.users.set( user.id, user );
		this.matches.set( user.id, match );

		console.log('match', match.id, 'new party:', user);
		// todo: Sim and coplayers should be informed that another player has joined
		return [ 200, { match:match.id, id:user.id, party:user.party } ];
	}


	this.handleRequest = function(method, path, params, resp) {
		var respond = httpUtils.respond;
		if(!path.length)
			return respond(resp, 400);

		if(path.length==1) {
			if(method=='GET')
				return httpUtils.serveStatic(resp, 'static/index.html');
			if(method=='POST') { // new match
				params.devMode = cfg.devMode;
				return respond(resp, this.matchCreate(params));
			}
			return respond(resp, 405,'Method Not Allowed')
		}

		if(path.length==2) {
			var id = path[1];
			var match = this.matches.get(id);
			if(method=='GET') { // reconnect
				if(!match || id==match.id)
					return respond(resp, 404, 'player not found');
				var user = match.users.get(id);
				console.log('match', match.id, 'reconnect:', user);
				return respond(resp, 200, { match:match.id, id:user.id, party:user.party });
			}
			if(method=='POST') { // join
				if(!match || id!=match.id)
					return respond(resp, 404, 'match not found');
				return respond(resp, this.userCreate(match, params));
			}
			return respond(resp, 405,'Method Not Allowed')
		}

		var userId = path[1];
		var match = this.matches.get(userId);
		if(!match || match.id===userId)
			return respond(resp, 404, 'match not found');
		var user = match.users.get(userId);
		if(!user)
			return respond(resp, 404, 'player not found');

		var cmd = path[2];
		var sim = match.sim;

		if(!cmd || cmd[0]=='_' || !(cmd in sim) || (typeof sim[cmd]!='function'))
			return respond(resp, 405, 'invalid command');

		console.log('<<', cmd, user.party, params)
		match.sim[cmd](user.party, params, function(data, code) {
			if((data!==null) && (typeof data == 'object') && ('serialize' in data))
				data = data.serialize();
			respond(resp, code ? code : data ? 200 : 204, data);
		});
	}

	this.path = topLevelPath;
	this.matches = new Map();
}
var serverPelagium = new ServerPelagium('pelagium');

//------------------------------------------------------------------

var server = httpUtils.createServer(cfg.host, cfg.port, function(req, resp, url) {
	switch(url.path[0]) { // toplevel services:
	case 'ping':
		resp.writeHead(200, {'Content-Type': 'text/plain'});
		return resp.end('pong\n');
	case serverPelagium.path:
		return serverPelagium.handleRequest(req.method, url.path, url.query, resp);
	case 'static':
		if(url.path.length==2)
			return httpUtils.serveStatic(resp, url.path[1], __dirname+'/'+url.path[0]);
	default:
		httpUtils.respond(resp, 404, "Not Found");
	}
}, function(req, url) { // redirect handler
	if(cfg.isOpenshift && req.headers['x-forwarded-proto'] == 'http') {
		return { protocol:'https' };
	}
	if(!url.path.length)
		return { path:[ serverPelagium.path ] };
});
httpUtils.onShutdown(function() { console.log( "\nshutting down..." ); });
