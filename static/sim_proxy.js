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
var baseUrl = location.origin + '/pelagium';

function SimProxy(params, callback) {
	var retryInterval = 5000;

	this.getSimEvents = function(party, params, callback) {
		if(party!=this.credentials.party)
			return console.error('getSimEvents wrong party. expected:', this.credentials.party,'actual:',party);

		var url = this.userUrl+'/getSimEvents';
		var cbPoll = function(data, code) {
			if(data)
				callback(data);
			setTimeout(function() { http.get(url, params, cbPoll); },
				(code==200 || code==204) ? 0 : retryInterval);
		}
		cbPoll(); // initiate long-polling
	}
	this.getTerrain = function(party, params, callback) {
		var key = '/getTerrain';
		var data = this.cache.getItem(key);
		if(data)
			callback(data);
		else http.get(this.userUrl+key, params, function(data) {
			this.cache.setItem(key, data);
			callback(data);
		}, this);
	}
	this.getSituation = function(party, params, callback) {
		var key = '/getSituation';
		http.get(this.userUrl+key, params, function(data, code) {
			if(code==200 || code==204) {
				this.cache.setItem(key, data);
				callback(data);
			}
			else {
				var data = this.cache.getItem(key);
				if(data)
					callback(data);
			}
		}, this);
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
			setTimeout(function(self) { self.postOrders(party, orders, turn); }, retryInterval, this);
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

	this._init = function(params, callback) {
		var url = baseUrl;
		var method = 'post';

		switch(params.cmd) {
			case 'resume':
				method = 'get';
				url += '/' + params.id;
				this.cache = new Cache('pelagium', params.id);
				break;
			case 'start':
				break;
			case 'join':
				url += '/' + params.id;
				break;
			default:
				return console.error('invalid or missing command:', params.cmd);
		}
		delete params.id;

		var self = this;
		var handleCredentials = function(data) {
			self.userUrl = baseUrl + '/' + data.id;
			self.credentials = data;
			console.log('connected to match', data);

			if(!self.cache)
				self.cache = new Cache('pelagium', data.id);
			else {
				var orders = self.cache.getItem('/postOrders');
				if(orders)
					self.postOrders(self.credentials.party, orders);
			}

			if(typeof localStorage !=='undefined' && params.mode!='AI')
				localStorage.setItem('pelagium', JSON.stringify({resume:data.id}));
			self.cache.setItem('/credentials', data);
			if(callback)
				callback(data, self);
		}

		http[method](url, params, function(data, code) {
			if(code!=200 || !('match' in data)) {
				var msg = data.error ? data.error : (params.cmd + ' failed.');
				switch(code) {
				case 404: 
					msg = 'invalid '+params.cmd+' id';
					break;
				case 0:
					msg = 'no connection';
					break;
				}
				if(self._resumeFromCache(callback))
					self.emit('warn', msg);
				else
					self.emit('error', msg);
				return console.error('connect failed. code:', code, data.error ? data.error : data);
			}

			var matchId = data.match;
			if(data.id && ('party' in data))
				return handleCredentials(data);

			http.post(baseUrl+'/'+matchId, params, function(data, code) {
				if(code==200)
					return handleCredentials(data);

				self.emit('error', 'user registration failed');
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
	this._init(params, callback);
}
