// client-side generic utilities

if(!window.requestAnimationFrame) window.requestAnimationFrame = (function(callback) {
	return window.webkitRequestAnimationFrame || 
	window.mozRequestAnimationFrame || 
	window.oRequestAnimationFrame || 
	window.msRequestAnimationFrame ||
	function(callback) { setTimeout(callback, 1000 / 60); };
})();

function extendCanvasContext(dc) {
	dc.circle = function(x,y,r, style) {
		if(style!==undefined) for(var key in style)
			this[key] = style[key];
		this.beginPath();
		this.arc(x,y, r, 0, 2*Math.PI, true);
		this.closePath();
		if(style.fillStyle) this.fill();
		if(style.strokeStyle) this.stroke();
	}
	dc.strokeCircle=function(x,y,r) {
		this.beginPath();
		this.arc(x,y, r, 0, 2*Math.PI, true);
		this.closePath();
		this.stroke();
	}
	dc.strokeLine=function(x1,y1,x2,y2) {
		this.beginPath();
		this.moveTo(x1,y1);
		this.lineTo(x2,y2);
		this.stroke();
	}
	dc.dashedLine = function(x, y, x2, y2, da) {
		if (!da) da = [10,5];
		this.save();
		var dx = (x2-x), dy = (y2-y);
		var len = Math.sqrt(dx*dx + dy*dy);
		var rot = Math.atan2(dy, dx);
		this.translate(x, y);
		this.moveTo(0, 0);
		this.rotate(rot);
		var dc = da.length;
		var di = 0, draw = true;
		x = 0;
		while (len > x) {
			x += da[di++ % dc];
			if (x > len) x = len;
			draw ? this.lineTo(x, 0): this.moveTo(x, 0);
			draw = !draw;
		}
		this.restore();
	}
	dc.hex = function(x,y,r, style) {
		var rx = r/2, ry = Math.sin(Math.PI/3)*r;
		if(style!==undefined) for(var key in style)
			this[key] = style[key];

		this.beginPath();
		this.moveTo(x-rx,y-ry);
		this.lineTo(x-r,y);
		this.lineTo(x-rx,y+ry);
		this.lineTo(x+rx,y+ry);
		this.lineTo(x+r,y);
		this.lineTo(x+rx,y-ry);
		this.closePath();
		if(style.fillStyle)
			this.fill();
		if(style.strokeStyle)
			this.stroke();
	}
	return dc;
}

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

	request: function(method, url, params, callback) {
		var xhr = new XMLHttpRequest();
		try {
			xhr.open( method, url, true );
			if(params && method=='POST')
				xhr.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
			if(callback) xhr.onload = xhr.onerror = function(event) {
				var status = (xhr.status===undefined) ? -1 : (xhr.status==1223) ? 204 : xhr.status;
				var response = (xhr.status==-1 || xhr.status==204) ? null
					: (xhr.contentType=='application/json' || (('getResponseHeader' in xhr) && xhr.getResponseHeader('Content-Type')=='application/json'))
					? JSON.parse(xhr.responseText) : xhr.responseText;
				callback( response, status );
			}
			xhr.send( (params && method=='POST') ? this.encodeURI(params) : null );
		} catch(error) {
			window.console && console.error(error);
			return false;
		}
		return xhr;
	},

	get: function(url, params, callback) {
		if(params)
			url+='?'+this.encodeURI(params);
		return this.request('GET', url, null, callback);
	},

	post: function(url, params, callback) {
		return this.request('POST', url, params, callback);
	}
}

eludi = {
	/// returns URL parameters as map
	paramsRequest: function() {
		var map = (typeof params === 'undefined') ? {} : params;
		if(window.location.protocol!='file:' && sessionStorage && sessionStorage['eludi_paramsRequest']) {
			var storedParams = JSON.parse(sessionStorage['eludi_paramsRequest']);
			for(var key in storedParams)
				map[key] = storedParams[key];
			delete sessionStorage['eludi_paramsRequest'];
		}
		if(window.location.href.indexOf('?')>=0)
			window.location.href.replace(/[?&]+([^=&]+)=([^&]*)/gi, function(m,key,value) {
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
		var cb = function(e) {
			var events = eludi.normalizeEvents(e);
			for(var i=0; i<events.length; ++i)
				callback(events[i]);
			return true;
		}

		if(typeof target.style.touchAction != 'undefined')
			target.style.touchAction = 'none';
		target.oncontextmenu = function(e){ return false; }

		this.normalizeEvents.pointerDown=[];
		if(window.PointerEvent) {
			target.onpointerdown = target.onpointermove = target.onpointerup = target.onpointerout
				= function(event) { return cb(event); };
		}
		else {
			target.onmousedown = target.onmousemove = target.onmouseup = target.onmouseout
				= function(event) { return cb(event); };
			target.ontouchstart = function(event) { this.onmousedown=null; return cb(event); };
			target.ontouchend = function(event) { this.onmouseup=null; return cb(event); };
			target.ontouchmove = function(event) { this.onmousemove=null; return cb(event); };
		}
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
		var pointersDown = this.normalizeEvents.pointerDown;
		var readPointerId = function(pointerId) {
			for(var i=0, end=pointersDown.length; i!=end; ++i)
				if(pointersDown[i]==pointerId)
					return i;
		}
		var writePointerId = function(pointerId) {
 			for(var i=0; ; ++i)
				if(pointersDown[i] === undefined)
					return i;
		}

		if(!e)
			e = window.event;
		if (e.preventManipulation)
			e.preventManipulation();
		if (e.preventDefault)
			e.preventDefault();

		var events = [];
		if(e.type in { 'touchstart':true, 'touchmove':true, 'touchend':true }) {
			var node = e.target;
			var offsetX = 0, offsetY=0;
			while(node && (typeof node.offsetLeft != 'undefined')) {
				offsetX += node.offsetLeft;
				offsetY += node.offsetTop;
				node = node.offsetParent;
			}
			for(var i=0; i<e.changedTouches.length; ++i) {
				var touch = e.changedTouches[i];
				var id, type = e.type.substr(5);
				if(type=='start') {
					id = writePointerId(touch.identifier);
					pointersDown[id] = touch.identifier;
				}
				else {
					id = readPointerId(touch.identifier);
					if(id===undefined)
						continue;
					if(type=='end')
						delete pointersDown[id];
				}
				events.push({ type:type, id:id, pointerType:'touch',
					pageX:touch.pageX, pageY:touch.pageY,
					clientX:touch.clientX,clientY:touch.clientY,
					x: touch.clientX - offsetX, y: touch.clientY - offsetY });
			}
		}
		else if(window.PointerEvent) { // pointer events
			var id, type = null;
			if(e.type=='pointerdown') {
				type = 'start';
				id = (e.pointerType=='mouse') ? e.button : writePointerId(e.pointerId);
				pointersDown[id] = e.pointerId;
			}
			else if(e.type in {'pointerup':true, 'pointerout':true}) {
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
			if(type) events.push({ type:type, target:e.target, id:id, pointerType:e.pointerType,
				pageX:e.pageX, pageY:e.pageY,
				clientX:e.clientX,clientY:e.clientY,
				x:e.offsetX,y:e.offsetY });
		}
		else { // mouse events:
			if(e.offsetX===undefined) { // Firefox
				var target = e.target || e.srcElement,
					rect = target.getBoundingClientRect();
				e.offsetX = e.clientX - rect.left,
				e.offsetY = e.clientY - rect.top;
			}
			if(e.pageX===undefined) {
				e.pageX = e.clientX + document.body.scrollLeft + document.documentElement.scrollLeft;
				e.pageY = e.clientY + document.body.scrollTop + document.documentElement.scrollTop;
			}
			var type = null, id = e.button;
			if(e.type=='mousedown') {
				type = 'start';
				pointersDown[id] = true;
			}
			else if(e.type in {'mouseup':true, 'mouseout':true}) {
				if(pointersDown[id])
					type = 'end';
				pointersDown[id] = false;
			}
			else if(e.type=='mousemove')
				type = pointersDown[id] ? 'move' : 'hover';

			if(type) events.push({ type:type, target:e.target, id:id, pointerType:'mouse',
				pageX:e.pageX, pageY:e.pageY,
				clientX:e.clientX,clientY:e.clientY,
				x:e.offsetX,y:e.offsetY });
		}
		return events.length ? events : false;
	},
	/// switches a single child on, and all other children of its parent off
	switchToChild: function(childId, display) {
		var refChild = document.getElementById(childId);
		if(!refChild) return false;
		if(display===undefined)
			display="block";
		var parent= refChild.parentNode;
		for(var i = 0; i < parent.childNodes.length; ++i) {
			var child = parent.childNodes[i];
			if(child.nodeType!=1) continue;
			child.style.display = (child===refChild) ? display : "none";
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
			if(window.location.protocol!='file:' && sessionStorage)
				sessionStorage['eludi_paramsRequest']=JSON.stringify(params);
			else url += '?' + this.encodeURI(params);
		}
		if(replace)
			window.location.replace(url);
		else window.location.href=url;
	},

}

function ButtonController(selector, callback) {
	var element = document.querySelector(selector);
	this.setMode = function(mode) {
		for(var i=0, end=element.children.length; i<end; ++i) {
			var child = element.children[i];
			if(child.dataset.id == mode) {
				child.style.display='';
				this.mode = mode;
			}
			else
				child.style.display='none';
		}
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
	this.mode = '';
	var self = this;
	element.onclick = function(evt) {
		callback({type:self.mode, currentTarget:evt.currentTarget});
	};
}
