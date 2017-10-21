var qs = require('querystring');

var httpUtils = require('./httpUtils');
var Sim = require('./sim');
var Storage = require('./DiskStorage');

var cfg = {
	host:'0.0.0.0',
	port:1771,
	devMode: 1,
	persistence:false,
	gcInterval: 60*60*12,
	matchTimeout: 60*60*24*3,
	matchOverTimeout: 60*60*24
}
httpUtils.parseArgs(process.argv.slice(2), cfg);
console.log(cfg);

//------------------------------------------------------------------

function ServerPelagium(topLevelPath, persistence) {

	this.makeid = function(len, prefix) {
		var possible = "ABCDEFGHKLMNPQRSTUVWXYZ123456789";
		var valuesPerChar = possible.length;
		do {
			var id = (typeof prefix === 'string') ? prefix : "";
			for( var i = id.length; i < len; ++i)
				id += possible.charAt(Math.floor(Math.random() * valuesPerChar));
		} while(this.matches.has(id));
		return id;
	}

	this.matchCreate = function(params) {
		var id = params.id = this.makeid(6);
		var sim = new Sim(params);
		if(sim.state!='running')
			return [ 400, 'invalid match parameters' ];
	
		this.matches.set(id, { id:id, sim:sim, users:new Map() });
		++this.matchCount;
		return [ 200, { match:id } ];
	}
	this.matchInsert = function(id, data) {
		if(this.matches.has(id)) {
			console.warn('cannot insert match id', id, ': id already exists.');
			return false;
		}
		var match = { id:id, sim:new Sim(data.sim), users:new Map() };

		var allIdsUnique = true;
		for(var i=0; i<data.users.length && allIdsUnique; ++i) {
			var userId = data.users[i][0];
			if(this.matches.has(userId)) {
				console.warn('cannot insert match id', id, ': user id', userId, 'already exists.');
				return false;
			}
			match.users.set(userId, data.users[i][1]);
		}
		this.matches.set( id, match );
		match.users.forEach(function(user, id) {
			this.matches.set( id, match );
		}, this);
		++this.matchCount;
		return true;
	}
	this.matchDelete = function(id) {
		var match = this.matches.get(id);
		if(!match || id != match.id)
			return;
		match.users.forEach(function(value, key) {
			this.matches.delete(key);
		}, this);
		this.matches.delete(id);
		if(this.storage)
			this.storage.removeItem(id);
	}
	this.matchSerialize = function(id) {
		var match = this.matches.get(id);
		if(!match || id != match.id)
			return null;
		return { sim:match.sim._serialize(), users:Array.from(match.users.entries()) };
	}

	this.userCreate = function(match, params) {
		var numPlayersMax = 2;
		var numPlayers = match.users.size;
		if(numPlayers >= numPlayersMax)
			return [ 403, 'Additional players forbidden'];

		var user = { party: match.users.size + 1 };
		user.id = this.makeid(6, match.id.substr(0,1)); 
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

	this.resumeFrom = function(storage) {
		var keys = storage.keys();
		var numResumed = 0;
		keys.forEach(function(id) {
			var data = storage.getItem(id);
			if(data && this.matchInsert(id, data))
				++numResumed;
			else
				storage.removeItem(id);
		}, this);
		console.log(numResumed, 'matches resumed');
	}

	this.collectGarbage = function() {
		this.matches.forEach(function(match, id) {
			if(match.id!=id)
				return;
			var now = new Date()/1000.0;
			if(match.sim.state=='over' && match.sim.lastUpdateTime+cfg.matchOverTimeout < now)
				this.matchDelete(id);
			else if(match.sim.lastUpdateTime+cfg.matchTimeout < now)
				this.matchDelete(id);
		}, this);
	}

	this.usage = function() {
		return {
			matchesRunning: this.matches.size,
			matchesTotal: this.matchCount,
			startTime: this.startTime.toISOString(),
			upTime: (new Date())-this.startTime
		}
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
		if(match.sim[cmd](user.party, params, function(data, code) {
			if((data!==null) && (typeof data == 'object') && ('serialize' in data))
				data = data.serialize();
			respond(resp, code ? code : data ? 200 : 204, data);
		}) && this.storage) {
			this.storage.setItem(match.id, this.matchSerialize(match.id));
		}
	}

	this.path = topLevelPath;
	this.matches = new Map();
	this.matchCount = 0;
	this.startTime = new Date();
	if(persistence) {
		this.storage = new Storage(persistence);
		this.resumeFrom(this.storage);
	}

	setInterval(function(self) { self.collectGarbage(); }, cfg.gcInterval * 1000, this);
}
var serverPelagium = new ServerPelagium('pelagium', cfg.persistence);

//------------------------------------------------------------------

var server = httpUtils.createServer(cfg.host, cfg.port, function(req, resp, url) {
	switch(url.path[0]) { // toplevel services:
	case 'ping':
		return httpUtils.respond(resp, 200, 'pong');
	case serverPelagium.path:
		return serverPelagium.handleRequest(req.method, url.path, url.query, resp);
	case 'static':
		if(url.path.length==2)
			return httpUtils.serveStatic(resp, url.path[1], __dirname+'/'+url.path[0]);
	case 'info':
		return httpUtils.respond(resp, 200, { usage:server.usage() });
	default:
		httpUtils.respond(resp, 404, "Not Found");
	}
}, function(req, url) { // redirect handler
	if(!url.path.length)
		return { path:[ serverPelagium.path ] };
});
server.usage = function() {
	var data = {
		pelagium: serverPelagium.usage(),
		memoryUsage: process.memoryUsage()
	}
	if('cpuUsage' in process)
		data.cpuUsage = process.cpuUsage()
	return data;
}

httpUtils.onShutdown(function() { console.log( "shutting down." ); });
httpUtils.onInfo(function() { console.log(server.usage()); });
