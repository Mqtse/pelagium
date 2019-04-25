// client-side generic utilities

http = {
	encodeURI: function(obj) {
		var s = '';
		for(var key in obj) {
			if(s.length) s += '&';
			var value = obj[key];
			if(typeof value == 'object')
				value = JSON.stringify(value);
			s += key+'='+encodeURIComponent(value);
		}
		return s;
	},

	request: function(method, url, params, callback, self) {
		var xhr = new XMLHttpRequest();
		try {
			xhr.open( method, url, true );
			if(this.timeout)
				xhr.timeout = this.timeout;
			if(params && method=='POST')
				xhr.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
			if(callback) xhr.onload = xhr.onerror = xhr.ontimeout = function(event) {
				var status = (xhr.status===undefined) ? -1 : (xhr.status==1223) ? 204 : xhr.status;
				var response = (xhr.status==-1 || xhr.status==204) ? null
					: (xhr.contentType=='application/json' || (('getResponseHeader' in xhr) && xhr.getResponseHeader('Content-Type')=='application/json'))
					? JSON.parse(xhr.responseText) : xhr.responseText;
				if(event.type == 'error')
					console.error(url, event);
				else if(event.type == 'timeout')
					status = 408;
				callback.call(self, response, status );
			}
			xhr.send( (params && method=='POST') ? this.encodeURI(params) : null );
		} catch(error) {
			console && console.error(error);
			if(callback)
				callback.call(self, error, -2);
			return false;
		}
		return xhr;
	},

	get: function(url, params, callback, self) {
		if(params)
			url+='?'+this.encodeURI(params);
		return this.request('GET', url, null, callback, self);
	},

	post: function(url, params, callback, self) {
		return this.request('POST', url, params, callback, self);
	},
	timeout: 32000
}

eludi = {
	/// returns URL parameters as map
	paramsRequest: function() {
		var map = (typeof params === 'undefined') ? {} : params;
		if(location.protocol!='file:' && sessionStorage && sessionStorage['eludi_paramsRequest']) {
			var storedParams = JSON.parse(sessionStorage['eludi_paramsRequest']);
			for(var key in storedParams)
				map[key] = storedParams[key];
			delete sessionStorage['eludi_paramsRequest'];
		}
		if(location.href.indexOf('?')>=0)
			location.href.replace(/[?&]+([^=&]+)=([^&]*)/gi, function(m,key,value) {
				var v = decodeURIComponent(value);
				map[key] = (v.charAt(0) in { '[':true, '{':true }) ? JSON.parse(v) : v;
			});
		return map;
	},

	addKeyEventListener: function(target, callback) {
		target.tabIndex=1; // also turns on keyboard events
		target.focus();
		target.addEventListener('keydown', callback);
	},
	addPointerEventListener: function(target, callback) {
		let cb = (e)=>{
			for(let i=0, events = this.normalizeEvents(e); i<events.length; ++i)
				callback(events[i]);
			return true;
		}

		if(typeof target.style.touchAction != 'undefined')
			target.style.touchAction = 'none';
		target.oncontextmenu = (e)=>{ return false; }

		this.normalizeEvents.pointerDown=[];
		if(window.PointerEvent)
			target.onpointerdown = target.onpointermove = target.onpointerup = target.onpointerout
				= /*target.onpointerenter = target.onpointerleave =*/ cb;
		else
			target.ontouchstart = target.ontouchend = target.ontouchmove = cb;
	},
	addWheelEventListener: function(callback) {
		var wheelNormalize = function(e){
			if(!callback || !e.deltaY)
				return;
			callback({ type:e.type, target:e.target, pointerType:'mouse',
				pageX:e.pageX, pageY:e.pageY,
				clientX:e.clientX,clientY:e.clientY,
				x:e.offsetX, y:e.offsetY, deltaY:e.deltaY });
		}
		window.addEventListener('wheel', wheelNormalize, false);
	},
	normalizeEvents: function(e) {
		let pointersDown = this.normalizeEvents.pointerDown;
		let readPointerId = function(pointerId) {
			for(let i=0, end=pointersDown.length; i!=end; ++i)
				if(pointersDown[i]==pointerId)
					return i;
		}
		let writePointerId = function(pointerId) {
			for(let i=0; ; ++i) {
				if(pointersDown[i] === pointerId)
					return -1;
				else if(pointersDown[i] === undefined)
					return i;
			}
		}

		let events = [];
		if(window.PointerEvent) { // pointer events
			let id, type = null;
			if(e.type in {'pointerdown':true, 'pointerenter':true}) {
				id = (e.pointerType=='mouse') ? e.button : writePointerId(e.pointerId);
				if(id>=0) {
					type = 'start';
					pointersDown[id] = e.pointerId;
				}
			}
			else if(e.type in {'pointerup':true, 'pointerout':true, 'pointerleave':true}) {
				id = readPointerId(e.pointerId);
				if(id===undefined)
					return false;
				type = 'end';
				delete pointersDown[id];
			}
			else if(e.type=='pointermove') {
				id = readPointerId(e.pointerId);
				if(id!==undefined)
					type = 'move';
				else if(e.pointerType=='mouse')
					type = 'hover';
			}
			if(type) events.push({ type:type, target:e.target, id:id || 0, pointerType:e.pointerType,
				pageX:e.pageX, pageY:e.pageY,
				clientX:e.clientX,clientY:e.clientY,
				x:e.offsetX,y:e.offsetY });
		}
		else if(e.type in { 'touchstart':true, 'touchmove':true, 'touchend':true, 'touchcancel':true, 'touchleave':true }) {
			e.preventDefault();

			let node = e.target;
			let offsetX = 0, offsetY=0;
			while(node && (typeof node.offsetLeft != 'undefined')) {
				offsetX += node.offsetLeft;
				offsetY += node.offsetTop;
				node = node.offsetParent;
			}
			for(let i=0; i<e.changedTouches.length; ++i) {
				let touch = e.changedTouches[i];
				let id, type = e.type.substr(5);
				if(type=='start') {
					id = writePointerId(touch.identifier);
					pointersDown[id] = touch.identifier;
				}
				else {
					id = readPointerId(touch.identifier);
					if(id===undefined)
						continue;
					if(type=='cancel' || type=='leave')
						type = 'end';
					if(type=='end')
						delete pointersDown[id];
				}
				events.push({ type:type, id:id, pointerType:'touch',
					pageX:touch.pageX, pageY:touch.pageY,
					clientX:touch.clientX,clientY:touch.clientY,
					x: touch.clientX - offsetX, y: touch.clientY - offsetY });
			}
		}
		return events.length ? events : false;
	},
	/// switches a single sibling on, and all other siblings off
	switchToSibling: function(id, display) {
		var refNode = document.getElementById(id);
		if(!refNode)
			return false;
		if(display===undefined)
			display="block";
		var siblings = refNode.parentNode.childNodes;
		for(var i = 0; i < siblings.length; ++i) {
			var node = siblings[i];
			if(node.nodeType==1)
				node.style.display = (node===refNode) ? display : "none";
		}
		return true;
	},
	click2touch: function(elems) {
		var evt='onclick';
		if(window.PointerEvent)
			evt = 'onpointerdown';
		else if(window.ontouchstart)
			evt = 'ontouchstart';
		else
			return evt;

		if(!elems)
			elems = document.getElementsByTagName('*');
		for(var i=0; i<elems.length; ++i) {
			var elem = elems[i];
			if(elem.onclick && !elem[evt]) {
				elem.callback = elem.onclick;
				elem[evt]=function(e) { e.preventDefault(); return this.callback(e); }
				elem.onclick=null;
			}
		}
		return evt;
	},
	/// opens another (eludi) url and passes parameters preferably via sessionStorage
	openUrl: function(url, params, replace) {
		if(params) {
			if(location.protocol!='file:' && sessionStorage)
				sessionStorage['eludi_paramsRequest']=JSON.stringify(params);
			else url += '?' + this.encodeURI(params);
		}
		if(replace)
			location.replace(url);
		else location.href=url;
	},

}

function ButtonController(selector, callback) {
	var element = document.querySelector(selector);
	this.setMode = function(mode) {
		for(var i=0, end=element.children.length; i<end; ++i) {
			var child = element.children[i];
			if(child.dataset.id == mode) {
				child.style.display = '';
				this.mode = mode;
			}
			else
				child.style.display='none';
		}
		element.style.display = '';
		return this;
	}
	this.setBackground = function(bg) {
		for(var i=0, end=element.children.length; i<end; ++i) {
			var child = element.children[i];
			child.style.background = bg;
		}
		return this;
	}
	this.setFocus = function(hasFocus) {
		var child = element.querySelector("[data-id='"+this.mode+"']")
		if(child)
			child.style.animation = hasFocus ? 'focus_keyframes 1.33s infinite ease-in-out' : '';
		return this;
	}
	this.show = function() {
		element.style.display = '';
	}
	this.hide = function() {
		element.style.display = 'none';
	}
	this.mode = '';
	element.onclick = (evt)=>{
		callback({type:this.mode, currentTarget:evt.currentTarget});
	};
}
