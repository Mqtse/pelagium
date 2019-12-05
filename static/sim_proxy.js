//--- Cache --------------------------------------------------------
function Cache(name, sessionId) {
	this.setItem = function(key, value) {
		this.storage.setItem(this.prefix+key, JSON.stringify(value));
		if(this.keys[key] !== true) {
			this.keys[key] = true;
			this.storage.setItem(this.prefix, JSON.stringify(this.keys));
		}
	}
	this.getItem = function(key) {
		if(!(key in this.keys))
			return null;
		var value = this.storage.getItem(this.prefix+key);
		return value ? JSON.parse(value) : value;
	}
	this.removeItem = function(key) {
		if(!(key in this.keys))
			return;
		delete this.keys[key];
		this.storage.removeItem(this.prefix+key);
		this.storage.setItem(this.prefix, JSON.stringify(this.keys));
	}
	this.clear = function() {
		for(var key in this.keys)
			this.storage.removeItem(this.prefix+key);
		this.keys = {};
	}

	var init = function(name, sessionId, storage) {
		this.storage = storage;
		this.prefix = name+'_';
		var keyStr = storage.getItem(this.prefix);
		this.keys = keyStr ? JSON.parse(keyStr) : {};
		var sessionIdKey = '/sessionId';
		if(!keyStr)
			this.setItem(sessionIdKey, sessionId);
		else {
			var storedSessionId = this.getItem(sessionIdKey);
			if(storedSessionId != sessionId) {
				this.clear();
				this.setItem(sessionIdKey, sessionId);
			}
		}
	}
	if(typeof localStorage !== 'undefined')
		init.call(this, name, sessionId, localStorage);
	else {
		this.setItem = function(key, value) { }
		this.getItem = this.removeItem = function(key) { }
		this.clear = function() { }
	}
}

// --- SimProxy ----------------------------------------------------
var baseUrl = (location.origin ? location.origin : '') + '/pelagium';

function SimProxy(params, callback) {
	var retryInterval = 5000;

	this.getSimEvents = function(party, params, callback) {
		if(party!=this.credentials.party)
			return console.error('getSimEvents wrong party. expected:', this.credentials.party,'actual:',party);

		var url = this.userUrl+'/getSimEvents';
		if(this.isSynchronous)
			return http.get(url, params, callback);

		var cbPoll = function(data, code) {
			if(data)
				callback(data, code);
			setTimeout(()=>{ http.get(url, params, cbPoll); },
				(code==200 || code==204 || code==408) ? 5 : retryInterval);
		}
		cbPoll(null, 204); // initiate long-polling
	}
	this.getTerrain = function(party, params, callback) {
		let key = '/getTerrain';
		let data = this.cache.getItem(key);
		if(data)
			return callback(data);

		let attempt=0, attemptsMax=4;
		let self = this;
		let cb = function(data, code) {
			if(code==200) {
				self.cache.setItem(key, data);
				callback(data);	
			}
			else if(++attempt <= attemptsMax) {
				setTimeout(()=>{
					http.get(self.userUrl+key, params, cb, self);
				}, 250 * Math.pow(2, attempt));
			}
			else {
				console.error(key, 'failed. Code:', code, data);
				callback();
			}
		}
		http.get(this.userUrl+key, params, cb, this);
	}
	this.getSituation = function(party, params, callback) {
		let key = '/getSituation';
		let attempt=0, attemptsMax=4;
		let self = this;

		let cb = function(data, code) {
			if(code==200 && (typeof data == 'object') && ('turn' in data)) {
				self.cache.setItem(key, data);
				callback(data);
			}
			else if(++attempt <= attemptsMax) {
				setTimeout(()=>{
					http.get(self.userUrl+key, params, cb, self);
				}, 250 * Math.pow(2, attempt));
			}
			else {
				console.error(key, 'failed. Code:', code, data);
				let cachedData = self.cache.getItem(key);
				callback(cachedData);
			}
		}
		http.get(this.userUrl+key, params, cb, this);
	}
	this.postOrders = function(party, orders, turn) {
		if(party!=this.credentials.party)
			return;
		var key = '/postOrders';
		var data = { orders:orders, turn:turn };
		http.post(this.userUrl+key, data, function(data, code) {
			if(code==200 || code==204)
				return this.cache.removeItem(key);
			else if(code>=400 && code<500) {
				console.warn('orders rejected.', code, data);
				this.emit('warn', 'orders rejected.');
				return this.cache.removeItem(key);
			}
			this.cache.setItem(key, orders);
			console.warn('posting orders to server failed. Orders are cached locally.')
			setTimeout(()=>{ this.postOrders(party, orders, turn); }, retryInterval);
		}, this);
	}

	this._resumeFromCache = function(callback) {
		var credentials = this.cache ? this.cache.getItem('/credentials') : null;
		if(!credentials)
			return false;

		this.userUrl = baseUrl + '/' + credentials.id;
		this.credentials = credentials;
		if(callback)
			callback(credentials, this);
		return true;
	}

	this._handleCredentials = function(data, mode) {
		this.userUrl = baseUrl + '/' + data.id;
		this.credentials = data;
		console.log('connected to match', data);

		if(!this.cache)
			this.cache = new Cache('pelagium', data.id);
		else {
			var orders = this.cache.getItem('/postOrders');
			if(orders)
				this.postOrders(this.credentials.party, orders);
		}

		if(typeof localStorage !=='undefined' && mode!='AI' && mode!='demo' && mode!='tutorial')
			localStorage.setItem('pelagium', JSON.stringify({resume:data.id}));
		this.cache.setItem('/credentials', data);
		callback(data, this);
	}

	this._init = function(params) {
		var url = baseUrl;
		var method = 'post';

		switch(params.cmd) {
			case 'resume':
				method = 'get';
				url += '/' + params.id;
				this.cache = new Cache('pelagium', params.id);
				break;
			case 'demo':
			case 'start':
			case 'tutorial':
				break;
			case 'join':
				url += '/' + params.id;
				break;
			default:
				console.error('invalid or missing command:', params.cmd);
				return callback();
		}
		delete params.id;

		let aiOpponents = [];
		if(params.cmd in {'start':true,'demo':true, 'tutorial':true} && params.parties) {
			for(let key in params.parties) {
				let value = params.parties[key];
				if(value == 0)
					params.party = key;
				else if(value == 1)
					aiOpponents.push({ party:key, mode:'AI' });
			}
		}

		http[method](url, params, (data, code)=>{
			if(code!=200 || !('match' in data)) {
				var msg = data.error ? data.error : (params.cmd + ' failed.');
				switch(code) {
				case 404: 
					msg = 'invalid '+params.cmd+' id';
					if(params.cmd==='resume' && typeof localStorage !=='undefined')
						localStorage.removeItem('pelagium');
					break;
				case 0:
					msg = 'no connection';
					break;
				}
				if(this._resumeFromCache(callback))
					this.emit('warn', msg);
				else
					this.emit('error', msg);
				return console.error('connect failed. code:', code, data.error ? data.error : JSON.stringify(data));
			}

			var matchId = data.match;
			if(data.id && ('party' in data))
				return this._handleCredentials(data, params.mode);

			http.post(baseUrl+'/'+matchId, params, (data, code)=>{
				if(code==200) {
					for(let i=0; i<aiOpponents.length; ++i) {
						let ai = aiOpponents[i];
						data.parties[ai.party] = ai;
					}
					if(params.cmd in {'demo':true, 'tutorial':true})
						params.mode = data.mode = params.cmd;
					return this._handleCredentials(data, params.mode);
				}

				this.emit('error', 'user registration failed');
				console.error(msg, 'code:', code, data.error ? data.error : data);
			});
		});
	}

	this.on = function(event, callback) {
		if(!(event in this.eventListeners))
			this.eventListeners[event] = [];
		this.eventListeners[event].push(callback);
	}
	this.emit = function(event, data) {
		[event, '*'].forEach(function(key) {
			if(key in this.eventListeners) {
				let callbacks = this.eventListeners[key];
				for(let i=0; i<callbacks.length; ++i)
					callbacks[i](event, data);
			}
		}, this);
	}

	this.eventListeners = {};
	this.cache = null;
	this.userUrl = '';
	this.credentials = null;
	this.isSynchronous = params.isSynchronous ? true : false;
	if(callback)
		this._init(params);
}
