

// --- SimDelegate -------------------------------------------------

function SimProxy(params, callback) {

	this.getSimEvents = function(party, params, callback) {
		this._postMsg('getSimEvents', party, params, callback);
	}
	this.getTerrain = function(party, params, callback) {
		this._postMsg('getTerrain', party, params, callback);
	}
	this.getSituation = function(party, params, callback) {
		this._postMsg('getSituation', party, params, callback);
	}
	this.postOrders = function(party, params, callback) {
		this._postMsg('postOrders', party, params, callback);
	}

	this._postMsg = function(type, party, params, callback) {
		let msg = { type:type, receiver:'sim', sender:party, data:params };
		if(callback) {
			msg.callback = party+'_'+type;
			SimProxy._callbacks[msg.callback] = callback;
		}
		postMessage(msg);
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
	this.cbCounter = 0;
	this.autoPilot = params.autoPilot ? true : false;
	if(callback)
		callback(params, this);
}

SimProxy._delegateMsg = function(msg) {
	if(msg.callback in SimProxy._callbacks) {
		let cb = SimProxy._callbacks[msg.callback];
		cb(msg.data);
		//delete SimProxy._callbacks[msg.callback];
	}
	else {
		console.warn('received response without callback:', msg);
	}
}
SimProxy._callbacks={};