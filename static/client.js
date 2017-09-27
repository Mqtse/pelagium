var baseUrl = location.origin + '/pelagium';

//--- animations ---------------------------------------------------
function AnimationSelected(tStart, unit, callback) {
	this.transform = function(tNow, transf) {
		var tFrac = tNow - this.tStart - 0.5;
		tFrac -= Math.floor(tFrac);
		var sc = Math.abs(tFrac - 0.5) * 0.5;
		transf.scx += sc;
		transf.scy += sc;
	}
	this.unit = unit;
	this.tStart = tStart;
}

function AnimationMove(tStart, unit, destination, callback, cbData) {
	var vel = 2.0;
	this.transform = function(tNow, transf) {
		var deltaT = tNow - this.tStart;
		if(deltaT*vel >= this.distance) {
			if(Array.isArray(destination) && destination.length > 1) {
				this.x += this.dx * this.distance;
				this.y += this.dy * this.distance;
				transf.x = this.x;
				transf.y = this.y;

				var angle = MatrixHex.angleRad(destination[0], destination[1]);
				this.distance = MatrixHex.distCart(destination[0], destination[1]);
				this.dx = Math.sin(angle);
				this.dy = -Math.cos(angle);
				this.tStart = tNow;
				destination.shift();				
			}
			else {
				this.unit.animation = null;
				if(callback)
					callback(this.unit, cbData);
				transf.x = this.x + this.dx * this.distance;
				transf.y = this.y + this.dy * this.distance;
			}
			return;
		}
		transf.x = this.x + this.dx * deltaT * vel;
		transf.y = this.y + this.dy * deltaT * vel;
	}
	this.unit = unit;
	var dest = Array.isArray(destination) ? destination[0] : destination;
	this.distance = MatrixHex.distCart(unit, dest);
	var angle = MatrixHex.angleRad(unit, dest);
	this.dx = Math.sin(angle);
	this.dy = -Math.cos(angle);
	this.x = 0;
	this.y = 0;	
	this.tStart = tStart;
}

function AnimationExplode(tStart, unit, callback, cbData) {
	var vel = 1.5;
	this.transform = function(tNow, transf) {
		var deltaT = tNow - this.tStart;
		if(deltaT*vel>=1.0) {
			this.unit.animation = null;
			if(callback)
				callback(this.unit, cbData);
			transf.opacity = 0.0;
			return;
		}
		var sc = 1+deltaT*vel;
		transf.scx += sc;
		transf.scy += sc;
		transf.opacity = 1.0 - deltaT*vel;
	}
	this.unit = unit;
	this.tStart = tStart;
}

function ProductionController(selector, unitColor, callback) {
	var element=document.querySelector(selector);

	this.setProduction = function(id, progress) {
		progress = progress ? progress/MD.Unit[id].cost : 0.0;
		if(progress > 1.0)
			progress = 1.0;
		for(var i=0, end=element.children.length; i<end; ++i) {
			var child = element.children[i];
			var toolId = child.dataset.id;
			var isSelected = (toolId == id);

			var canvas = child.firstElementChild;
			var dc = extendCanvasContext(canvas.getContext('2d'));
			dc.clearRect(0,0, canvas.width,canvas.height);

			var cx = canvas.width/2, cy=canvas.height/2;
			if(!isSelected)
				dc.circle(cx,cy, canvas.width*0.5, {fillStyle:'rgba(0,0,0,0.5)'});				
			else {
				dc.circle(cx,cy, canvas.width*0.4, {fillStyle:'rgba(0,0,0,0.5)'});

				dc.lineWidth = canvas.width*0.1;
				dc.beginPath();
				dc.strokeStyle='white';
				dc.arc(cx,cy, canvas.width*0.45, 1.5*Math.PI, 1.5*Math.PI+2*Math.PI*progress, false);
				dc.stroke();
				dc.strokeStyle='rgba(255,255,255,0.33)';
				dc.arc(cx,cy, canvas.width*0.45, 1.5*Math.PI+2*Math.PI*progress, 1.5*Math.PI+2*Math.PI, false);
				dc.closePath();
				dc.stroke();
				this.production = id;
			}
			var sz = 24;
			dc.save();
			dc.translate(0.5*(canvas.width-sz), 0.5*(canvas.height-sz));
			dc.beginPath();
			dc.rect(0,0, sz,sz);
			dc.clip();
			dc.fillStyle = unitColor;
			dc.fillRect(0,0, sz,sz);
			client.drawUnitSymbol(dc, toolId, sz,sz, sz/6, 'white');
			dc.restore();
		}
		return this;
	}
	this.setVisible = function(id, isVisible) {
		if(isVisible === undefined)
			isVisible = true;
		for(var i=0, end=element.children.length; i<end; ++i) {
			var child = element.children[i];
			if(child.dataset.id != id) 
				continue;
			child.style.display = isVisible ? 'inherit' : 'none';
			break;
		}
		return this;
	}

	for(var id in MD.Unit) {
		var unitType = MD.Unit[id];
		var item = document.createElement('li');
		item.dataset.id = id;

		var canvas = document.createElement('canvas');
		canvas.width = canvas.height = 48;
		item.appendChild(canvas);
		item.onclick = function(evt) {
			callback(evt.currentTarget.dataset.id);
			return true;
		}
		element.appendChild(item);
	}

	this.setProduction(); // initializes visualization
}

// --- SimProxy ----------------------------------------------------
function SimProxy(params, callback) {
	this.getSimEvents = function(party, params, callback) {
		if(party!=this.party)
			return;

		var url = this.userUrl+'/getSimEvents';
		var cbPoll = function(data) {
			if(data)
				callback(data);
			setTimeout(function() { http.get(url, params, cbPoll); }, 0);
		}
		cbPoll(); // initiate long-polling
	}
	this.getTerrain = function(party, params, callback) {
		http.get(this.userUrl+'/getTerrain', params, function(data) {
			callback(data);
		});
	}
	this.getSituation = function(party, params, callback) {
		http.get(this.userUrl+'/getSituation', params, function(data) {
			callback(data);
		});
	}
	this.postOrders = function(party, commands) {
		if(party!=this.party)
			return;
		http.post(this.userUrl+'/postOrders', { orders:commands });
	}
	this.getMatchId = function() { return this.matchId; }
	this.getUserId = function() { return this.userUrl.substr(this.userUrl.lastIndexOf('/')+1); }
	this._connect = function(params, callback) {
		var url = baseUrl;
		var method = 'post';

		switch(params.cmd) {
			case 'resume':
				method = 'get';
				url += '/' + params.id;
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
			if(localStorage)
				localStorage.pelagium = JSON.stringify({resume:data.id});
			self.party = data.party;
			console.log('connected to match', self.matchId, 'party:', data.party, 'id:', data.id);
			if(callback)
				callback({ party:data.party }, self);
		}

		http[method](url, params, function(data, code) {
			if(code!=200 || !('match' in data)) {
				var msg = (code==404) ? ('invalid '+params.cmd+' id') : data.error ? data.error : params.cmd + ' failed.';
				if(params.cmd=='resume' && localStorage)
					delete localStorage.pelagium;
				client.modalPopup(msg, ['OK'], function(id) { client.close(); });
				return console.error('connect failed. code:', code, data.error ? data.error : data);
			}

			var matchId = self.matchId = data.match;
			if(data.id && ('party'in data))
				return handleCredentials(data);

			http.post(baseUrl+'/'+matchId, params, function(data, code) {
				if(code==200)
					return handleCredentials(data);

				var msg = 'user registration failed';
				client.modalPopup(msg, ['OK'], function(id) { client.close(); });
				console.error(msg, 'code:', code, data.error ? data.error : data);
			});
		});
	}

	this.userUrl = '';
	this._connect(params, callback);
}

// --- client ------------------------------------------------------
client = {
	init: function(params, sim) {
		for(var key in settings)
			this[key] =(key in params) ?
				isNaN(parseInt(params[key])) ? params[key] : parseInt(params[key])
				: settings[key];

		this.background = document.getElementById('background');
		this.background.dc = extendCanvasContext(this.background.getContext("2d"));
		this.foreground = document.getElementById('foreground');
		this.foreground.dc = extendCanvasContext(this.foreground.getContext("2d"));
		this.vp = { x:0, y:0, width:1, height:1 };
		this.resize();

		var self = this;
		window.onresize=function() { self.resize(); }
		eludi.addPointerEventListener(this.foreground, function(event) { self.handlePointerEvent(event); });
		eludi.addWheelEventListener(function(event) { self.viewZoomStep(-event.deltaY, event.x, event.y); });
		eludi.addKeyEventListener(window, function(event) { self.handleKeyEvent(event); });

		this.btnMain = new ButtonController('#toolbar_main', function(evt) { self.handleUIEvent(evt); });
		this.btnMain.setMode('fwd').setBackground(MD.Party[this.party].color);
		document.getElementById('main_menu').addEventListener("click", function(event) {
			self.handleUIEvent({ type:event.target.dataset.id }); });
		document.getElementById('btn_menu').addEventListener("click", function(event) {
			self.handleUIEvent({ type:event.currentTarget.dataset.id }); });
		if(!document.fullscreenEnabled && !document.webkitFullscreenEnabled)
			document.querySelector('li[data-id="fullscreen"]').style.display = 'none';
		this.toolbarProduction = new ProductionController('#toolbar_production', MD.Party[this.party].color,
			function(unitType) { if(self.cursor) self.handleProductionInput(unitType, self.cursor.x, self.cursor.y); });
		this.toggleToolbar('main');
		eludi.click2touch();

		this.state = 'init';
		this.sim = sim;
		this.mapView = null;
		this.redrawMap = true;
		this.fov = null; // field of vision
		this.units = { };
		this.selUnit = null;
		this.selection = null;
		this.cursor = null;
		this.pointerEventStartTime = 0;
		this.time = 0;
		this.fps = 0;
		this.tLastUpdate = new Date()/1000.0;
		this.orders = [];
		this.simEvents = [];
		this.turn = 1;

		sim.getSimEvents(this.party, null, function(data) { self.handleSimEvents(data); });
		sim.getTerrain(this.party, null, function(data) {
			self.mapView = new MatrixHex(data);
			MapHex.finalizeAppearance(self.mapView);
			this.redrawMap = true;
			sim.getSituation(self.party, null, function(data) {
				self.handleSituation(data);
				// center view at own units:
				var cx=0, cy=0, numUnits=0;
				for(var id in self.units) {
					var unit = self.units[id];
					if(unit.party.id!=self.party)
						continue;
					cx += unit.x;
					cy += unit.y;
					++numUnits;
				}
				if(numUnits) {
					cx /= numUnits;
					cy /= numUnits;
					self.viewCenter(Math.round(cx), Math.round(cy));
				}
			});
		});
		this.update();
	},

	close: function(saveMatch) {
		if(saveMatch && this.state!='over') {
			var userId = this.sim.getUserId();
			var self = this;
			return this.modalPopup('resume id: '+userId, ['OK'], function() {
				eludi.openUrl(baseUrl, {}, false);
			});
		}
		eludi.openUrl(baseUrl, {}, false);
	},

	resize: function(scaleOnly) {
		var reservedWidth=0, reservedHeight=0;
		this.cellRadius = Math.tan(Math.PI/6)*this.cellHeight;
		this.cellWidth = 1.5*this.cellRadius;
		if(!('offsetX' in this)) {
			this.offsetX = 0.5*this.cellRadius;
			this.offsetY = 0;
		}
		if(!scaleOnly) {
			this.background.width = this.foreground.width = window.innerWidth-reservedWidth;
			this.background.height = this.foreground.height = window.innerHeight-reservedHeight;
		}
		this.vp.width = Math.ceil(1.25+this.background.width/this.cellWidth);
		this.vp.height = Math.ceil(1.5+this.background.height/this.cellHeight);
		this.redrawMap = true;
	},

	toggleFullScreen: function() {
		if(document.fullscreenEnabled) {
			if (!document.fullscreenElement)
				document.documentElement.requestFullscreen();
			else if(document.exitFullscreen)
				document.exitFullscreen();
		}
		else if(document.webkitFullscreenEnabled) {
			if (!document.webkitFullscreenElement)
				document.documentElement.webkitRequestFullscreen();
			else if(document.webkitExitFullscreen)
				document.webkitExitFullscreen();
		}
	},

	toggleMenu: function(onOrOff) {
		var m=document.getElementById('menus');
		if(onOrOff===undefined)
			m.style.display = (m.style.display=='none') ? '' : 'none';
		else
			m.style.display = onOrOff ? '' : 'none';
	},

	toggleToolbar: function(id) {
		if(id=='main' && id==this.currentToolbar)
			return;
		this.currentToolbar = id;
		eludi.switchToSibling('toolbar_'+id, '');
		
		if(id=='production' && this.cursor) {
			var tile = this.mapView.get(this.cursor.x, this.cursor.y);
			this.toolbarProduction.setProduction(tile.production, tile.progress);
		}
	},

	handlePointerEvent: function(event) {
		var offsetX = this.offsetX-0.75*this.cellRadius;
		var cellX = Math.floor((event.x-offsetX) / this.cellWidth) + this.vp.x;
		var offsetY = this.offsetY+((cellX%2) ? 0 : -0.5*this.cellHeight);
		var cellY = Math.floor((event.y-offsetY) / this.cellHeight) + this.vp.y;

		switch(event.type) {
		case 'start':
			if(event.id==1 && event.pointerType!='mouse') {
				this.panning = false;
				this.pointerEventStartTime = Date.now();
				this.pinch = [{x:this.prevX, y:this.prevY}, {x:event.x, y:event.y}];
			}
			else if(event.id==0) {
				this.pointerEventStartTime = Date.now();
				this.prevX = event.x;
				this.prevY = event.y;
			}
			break;
		case 'move':
			if(event.id>1 || !this.pointerEventStartTime) // ignore right mouse button / multi-touch
				return;
			if(this.pinch) {
				var dx = event.x - this.pinch[event.id].x, dy=event.y - this.pinch[event.id].y;
				var dist0 = Math.sqrt(Math.pow(this.pinch[1].x-this.pinch[0].x, 2)
					+ Math.pow(this.pinch[1].y-this.pinch[0].y, 2));
				this.pinch[event.id].x += dx;
				this.pinch[event.id].y += dy;
				var dist1 = Math.sqrt(Math.pow(this.pinch[1].x-this.pinch[0].x, 2)
					+ Math.pow(this.pinch[1].y-this.pinch[0].y, 2));
				var factor = dist1 / dist0;
				var centerX = Math.round((this.pinch[0].x+this.pinch[1].x)/2);
				var centerY = Math.round((this.pinch[0].y+this.pinch[1].y)/2);
				return this.viewZoom(factor, centerX, centerY, -dx/2, -dy/2);
			}
			var dx=this.prevX-event.x, dy=this.prevY-event.y;
			if(this.panning || (Math.pow(dx,2)+Math.pow(dy,2) >= Math.pow(this.cellRadius,2)) ) {
				this.panning = true;
				this.prevX = event.x;
				this.prevY = event.y;
				this.viewPan(dx, dy);
			}
			break;
		case 'end':
			if(event.id>1 || !this.pointerEventStartTime) // ignore right mouse button / multi-touch
				return;
			else if(this.pinch || this.panning) {
				this.pinch = this.panning = false;
				this.redrawMap = true;
			}
			else
				this.handleMapInput('click', cellX, cellY);
			this.pointerEventStartTime=0;
		}
	},

	handleKeyEvent: function(event) {
		var self = this;
		var currentCursor = function() {
			if(!self.cursor)
				self.cursor = { x:self.vp.x + Math.floor(self.vp.width/2),
					y:self.vp.y + +Math.floor(self.vp.height/2) };
			return self.cursor;
		}
		var which = event.which || event.keyCode;
		switch(which) {
		default:
			console.log(' key '+which+' down');
			return;
		case 9: // tab
		case 27: // escape
		case 10009: // RETURN on Samsung remote control
			console.log('switch input target');
			this.btnMain.setFocus(true);
			// todo
			return;
		case 13: // enter
		case 32: // space
			if(!this.cursor)
				currentCursor();
			else
				this.handleMapInput('click', this.cursor.x, this.cursor.y);
			event.preventDefault(); 
			break;
		case 33: // pgup
			return this.viewZoomStep(-1);
		case 34: // pgdown
			return this.viewZoomStep(1);
		case 37: // left
			--currentCursor().x;
			break;
		case 38: // up 
			--currentCursor().y;
			break;
		case 39: // right
			++currentCursor().x;
			break;
		case 40: // down
			++currentCursor().y;
			break;
		case 122: // F11
			return this.toggleFullScreen();
		}
		if(this.cursor && !this.isInsideViewport(this.cursor, 1))
			this.viewCenter(this.cursor.x, this.cursor.y);
	},

	handleUIEvent: function(event) {
		switch(event.type) {
		case 'fwd':
			return this.dispatchOrders();
		case 'pause':
			// todo
			break;
		case 'spinner':
			break; // ignore
		case 'fullscreen':
			this.toggleMenu(false);
			return this.toggleFullScreen();
		case "suspend":
			return this.close(true);
		case "surrender":
			return this.surrender();
		case "joinCredentials":
			return this.modalPopup('join id: '+this.sim.getMatchId(), ['OK']);
		case 'toggleMenu':
			return this.toggleMenu();
		default:
			console.error('unhandled UI event', event);
		}
	},

	handleProductionInput: function(unitType, x, y) { 
		if(this.state!='input')
			return;
		var tile = this.mapView.get(x, y);
		if(!tile || tile.terrain!=MD.OBJ || tile.party != this.party || tile.production==unitType || !(unitType in MD.Unit))
			return;

		var order = { type:'production', unit:unitType, x:x, y:y };
		console.log('order', order);
		this.orders.push(order);

		tile.production = unitType;
		tile.progress = 0;
		this.toolbarProduction.setProduction(unitType, 0.0);
	},

	handleMapInput: function(type, cellX, cellY) {
		if(this.state!='input')
			return;
		this.cursor = { x:cellX, y:cellY };
		if(this.selUnit && this.isSelected(cellX, cellY) && !this.selUnit.origin) {
			this.toggleToolbar('main');
			return this.moveUnit(this.selUnit, cellX, cellY);
		}

		var tile = this.mapView.get(cellX, cellY);
		if(!tile)
			return;
		for(var key in tile) {
			var value = tile[key];
			if(key=='terrain')
				this.cursor[key] = (value<0)? MD.Terrain[0].name : MD.Terrain[value].name;
			else if(key=='unit' && value!==null)
				this.cursor[key] = { type:value.type.id, party:value.party.name };
			else if(key!='color')
				this.cursor[key] = value;
		}
		if(tile.terrain == MD.OBJ && tile.party == this.party)
			this.toggleToolbar('production');
		else
			this.toggleToolbar('main');

		if(!tile.unit || (this.selUnit == tile.unit))
			this.deselectUnit();
		else
			this.selectUnit(tile.unit);

		this.displayStatus(JSON.stringify(this.cursor));
		this.draw(true);
	},

	viewZoomStep: function(delta, centerX, centerY) {
		for(var i=0; i<this.scales.length; ++i) 
			if(this.cellHeight==this.scales[i])
				break;
		var scale = this.cellHeight;
		if(delta<0 && i>0)
			scale = this.scales[i-1];
		else if(delta>0 && i+1<this.scales.length)
			scale = this.scales[i+1];
		if(this.cellHeight != scale) {
			var factor = scale / this.cellHeight;
			if(centerX===undefined)
				centerX = this.background.width/2;
			if(centerY===undefined)
				centerY = this.background.height/2;
			this.viewZoom(factor, centerX, centerY);
		}
	},

	viewZoom: function(factor, centerX, centerY, deltaX, deltaY) {
		var scale = factor * this.cellHeight;
		var scaleMin = this.scales[0], scaleMax = this.scales[this.scales.length-1];
		if(scale < scaleMin)
			scale = this.scales[0];
		else if(scale > scaleMax)
			scale = scaleMax;
		if(scale == this.cellHeight)
			return;
		var dx = centerX * (factor-1.0) + (deltaX!==undefined ? deltaX : 0);
		var dy = centerY * (factor-1.0) + (deltaY!==undefined ? deltaY : 0);
		this.cellHeight = scale;
		this.resize(true);
		this.viewPan(dx, dy);
	},

	viewPan: function(dX, dY) {
		this.offsetX -= dX;
		this.offsetY -= dY;
		this.vp.x -= (this.offsetX>=0) ? 
			Math.floor(this.offsetX / this.cellWidth) : Math.ceil(this.offsetX / this.cellWidth);
		this.vp.y -= (this.offsetY>=0) ?
			Math.floor(this.offsetY / this.cellHeight) : Math.ceil(this.offsetY / this.cellHeight);
		this.offsetX %= this.cellWidth;
		this.offsetY %= this.cellHeight;
		if(this.offsetX>0.5*this.cellRadius) {
			this.offsetX -=this.cellWidth;
			--this.vp.x;
		}
		if(this.offsetY>0) {
			this.offsetY -=this.cellHeight;
			--this.vp.y;
		}
		this.redrawMap = true;
	},

	viewCenter: function(x, y) {
		this.vp.x = Math.round(x-this.vp.width/2);
		this.vp.y = Math.round(y-this.vp.height/2);
		this.redrawMap = true;
	},

	isInsideViewport: function(pos, delta) {
		if(!delta)
			delta=0;
		return pos.x >= this.vp.x + delta
			&& pos.y >= this.vp.y + delta
			&& pos.x < this.vp.x + this.vp.width - delta
			&& pos.y < this.vp.y + this.vp.height - delta;
	},

	selectUnit: function(unit) {
		if(this.selUnit == unit || (unit && this.party && this.party != unit.party.id) || unit.origin)
			return;
		this.deselectUnit();
		if(unit) {
			this.selUnit = unit;
			unit.animation = new AnimationSelected(this.time, this.unit);
			this.selection = unit.getFieldOfMovement(this.mapView);
		}
	},
	deselectUnit: function() {
		if(!this.selUnit)
			return;
		this.selUnit.animation = null;
		this.selUnit = null;
		this.selection = null;
	},
	isSelected: function(x, y) {
		if(!this.selection)
			return false;
		for(var i=0, end=this.selection.length; i!=end; ++i) {
			var tile = this.selection[i];
			if(tile.x==x && tile.y==y)
				return true;
		}
		return false;
	},
	dispatchOrders: function() {
		if(this.state!='input')
			return;
		this.sim.postOrders(this.party, this.orders);
		this.orders = []; // better keep until acknowledged by events?
		for(var id in this.units) {
			var unit = this.units[id];
			if(!unit.origin)
				continue;
			unit.x = unit.origin.x;
			unit.y = unit.origin.y;
			delete unit.origin;
		}
		this.switchState('waiting');
	},

	moveUnit: function(unit, x, y) {
		var order = { type:'move', unit:unit.id,
			from_x:unit.x, from_y:unit.y, to_x:x, to_y:y };
		console.log('order', order);		
		this.orders.push(order); 

		this.selection = this.selUnit = null;

		// animate until unit is drawn at its new destination:
		var self = this;
		var path = unit.getPath(this.mapView, x,y);
		unit.animation = new AnimationMove(this.time, unit, path, function(unit, order) {
			delete self.mapView.get(order.from_x, order.from_y).unit;
			unit.origin = { x:unit.x, y:unit.y };
			unit.x = x;
			unit.y = y;
			self.mapView.get(x, y).unit = unit;
		}, order);
	},

	surrender: function() {
		if(this.state == 'over' || this.state=='init')
			return;
		var self = this;
		this.modalPopup("really surrender?",["yes", "no"], function(result){
			if(result==1)
				return;
			self.orders = [{ type:'surrender', party:self.party }];
			self.state='input';
			self.dispatchOrders();
			self.switchState('over');
			setTimeout(function() { self.close(); }, 0);
		});
	},

	drawUnit: function(dc, unit) {
		if(unit.state=='dead')
			return;
		var cellX = unit.x;
		var cellY = unit.y;

		var scale = this.cellRadius;
		var transf = { x:0.0, y:0.0, r:0.0, scx:1.0, scy:1.0, opacity:1.0 };
		if(unit.animation && (this.state=='input' || this.state=='replay'))
			unit.animation.transform(this.time, transf);
		var w=scale*transf.scx, h=scale*transf.scy;

		var x=(transf.x+cellX-this.vp.x)*this.cellWidth+this.offsetX - w/2;
		var y=(transf.y+cellY-this.vp.y)*this.cellHeight+this.offsetY + ((cellX%2) ? 0.5*this.cellHeight : 0) - h/2;

		var sprite = document.createElement('canvas'); // todo, maybe prerender all sprites at double resolution?
		sprite.width = w;
		sprite.height = h;
		var sdc = extendCanvasContext(sprite.getContext('2d'));
		sdc.fillStyle = unit.party.color;
		sdc.fillRect(0,0, w, h);
		this.drawUnitSymbol(sdc, unit.type.id, w,h, scale*transf.scx/6, 'white');

		dc.save();
		dc.globalAlpha = transf.opacity;
		dc.shadowColor='rgba(0,0,0,0.4)';
		dc.shadowOffsetX=sdc.lineWidth/2;
		dc.shadowOffsetY=sdc.lineWidth/2;
		dc.shadowBlur = sdc.lineWidth/2;
		dc.drawImage(sprite, x,y, w, h);
		dc.restore();
	},

	drawUnitSymbol: function(dc, type, w,h, lineWidth, color) {
		dc.strokeStyle = color;
		dc.lineWidth = lineWidth;
		switch(type) {
		case 'inf':
			dc.strokeLine(0,0, w,h);
			dc.strokeLine(0,h, w,0);
			break;
		case 'kv':
			dc.strokeLine(0,h, w,0);
			break;
		case 'art':
			dc.circle(w/2,h/2, 1.25*lineWidth, {fillStyle:color});
			break;
		}
	},

	drawSelTile: function(dc, tile) {
		var x = tile.x;
		var y = tile.y;
		var offsetY = this.offsetY;
		if(x%2) 
			offsetY+=0.5*this.cellHeight;
		var radius = this.cellRadius/6;
		dc.circle((x-this.vp.x)*this.cellWidth+this.offsetX, (y-this.vp.y)*this.cellHeight+offsetY, radius,
			{ fillStyle:tile.fillStyle ? tile.fillStyle : 'rgba(0,0,0, 0.33)' });
	},

	draw: function() {
		var fastMode = (this.panning || this.pinch) ? true : false;
		var drawWater = fastMode ? 1 : 0;
		var margin = .2;
		var fogOfWar = null;
		var fowScale=0.125;
		var fowRadius =(this.cellRadius+this.cellHeight/5)*fowScale;
		var lineWidth = this.cellRadius/8;
		var vp = this.vp;

		this.foreground.dc.clearRect( 0 , 0 , this.foreground.width, this.foreground.height );

		if(this.redrawMap && this.mapView) { // background:
			this.redrawMap = false;
			var dc = this.background.dc;
			dc.clearRect( 0 , 0 , this.background.width, this.background.height );
			if(this.fov && !fastMode) { // fog of war
				fogOfWar = document.createElement('canvas');
				var width = fogOfWar.width = this.background.width*fowScale;
				var height = fogOfWar.height = this.background.height*fowScale;
				var ctx = fogOfWar.dc = extendCanvasContext(fogOfWar.getContext('2d'));
				ctx.fillStyle='rgba(0,0,0,0.2)';
				ctx.fillRect(0,0, width, height);
				ctx.fillStyle='white';
				ctx.globalCompositeOperation='destination-out';
			}

			for(var x=Math.max(0,vp.x), xEnd=Math.min(vp.x+vp.width, this.mapView.width); x<xEnd; ++x) {
				var offsetY = this.offsetY;
				if(x%2) 
					offsetY+=0.5*this.cellHeight;
				for(var y=Math.max(0,vp.y), yEnd=Math.min(vp.y+vp.height, this.mapView.height); y<yEnd; ++y) {
					var tile = this.mapView.get(x,y);
					if(!tile)
						continue;
					var terrain = tile.terrain;
					var fill = ('color' in tile) ? tile.color : MD.Terrain[terrain].color;
					var cx = (x-vp.x)*this.cellWidth+this.offsetX, cy = (y-vp.y)*this.cellHeight+offsetY;
					if(terrain==MD.OBJ && tile.party && !fastMode) {
						var strokeStyle = MD.Party[tile.party].color;
						dc.hex(cx, cy, this.cellRadius-margin-lineWidth/2, { fillStyle:fill, strokeStyle:strokeStyle, lineWidth:lineWidth });
					}
					else if(fill && (terrain>=drawWater))
						dc.hex(cx, cy, this.cellRadius-margin, { fillStyle:fill });
					if(fogOfWar && this.fov.get(x,y)!==0)
						fogOfWar.dc.hex(cx*fowScale, cy*fowScale, fowRadius, { fillStyle:'white' });
				}
			}
			if(fogOfWar)
				dc.drawImage(fogOfWar, 0,0, this.background.width, this.background.height);
		}
		if(fastMode)
			return;

		// foreground:
		dc = this.foreground.dc;
		for(var id in this.units) {
			var unit = this.units[id];
			if(this.isInsideViewport(unit) && unit!=this.selUnit)
				this.drawUnit(dc, unit);
		}
		if(this.selUnit)
			this.drawUnit(dc, this.selUnit);

		if(this.selection)
			for(var i=this.selection.length; i--; )
				this.drawSelTile(dc, this.selection[i]);

		if(this.cursor && this.isInsideViewport(this.cursor) && (!this.selUnit || this.cursor.x!=this.selUnit.x || this.cursor.y!=this.selUnit.y)) {
			var x = this.cursor.x-vp.x;
			var y = this.cursor.y-vp.y;
			var offsetY = this.offsetY + ((this.cursor.x%2) ? 0.5*this.cellHeight : 0);
			var cx=x*this.cellWidth+this.offsetX, cy= y*this.cellHeight+offsetY;
			var r = 0.5*this.cellHeight-0.5*lineWidth;
			var deltaR = 0.07*r*Math.sin(this.time*1.5*Math.PI);
			dc.circle(cx, cy, r+deltaR, { strokeStyle: 'white', lineWidth:lineWidth });
		}
	},

	update: function() {
		var tNow = new Date()/1000.0;

		if((this.state=='input' || this.state=='replay')) {
			var deltaT = Math.min(tNow-this.tLastUpdate, 0.1);
			this.time += deltaT;
		}

		++this.fps;
		if(Math.floor(tNow)!=Math.floor(this.tLastUpdate)) {
			//this.displayStatus('fps:'+this.fps);
			this.fps=0;
		}

		this.tLastUpdate = tNow;
		this.draw();
		var self = this;
		requestAnimationFrame(function() { self.update(); });
	},

	handleSimEvents: function(events) {
		for(var i=0; i<events.length; ++i)
			this.simEvents.push(events[i]);
		this.switchState('replay');
	},

	handleSituation: function(data) {
		for(var i=0; i<this.mapView.data.length; ++i) {
			var tile = this.mapView.data[i];
			delete tile.unit;
			delete tile.party;
			delete tile.production;
			delete tile.progress;
		}

		this.units = { };
		for(var i=0; i<data.units.length; ++i) {
			var unit = data.units[i];
			var tile = this.mapView.get(unit.x, unit.y);
			tile.unit = this.units[unit.id] = new Unit(unit);
		}
		if(this.selUnit)
			this.selectUnit(this.units[this.selUnit.id]);

		for(var i=0; i<data.objectives.length; ++i) {
			var obj = data.objectives[i];
			var tile = this.mapView.get(obj.x, obj.y);
			tile.party = obj.party;
			if(obj.production) {
				tile.production = obj.production;
				tile.progress = obj.progress;
			}
		}

		this.fov = new MatrixHex(data.fov);

		this.redrawMap = true;
		this.turn = data.turn;
		if(data.state=='running')
			this.switchState(data.ordersReceived ? 'waiting' : 'input');
		else
			this.switchState(data.state);
	},

	updateProduction: function(numTurns) {
		for(var i=0; i<this.mapView.data.length; ++i) {
			var tile = this.mapView.data[i];
			if(tile.production)
				tile.progress += numTurns;
		}
	},

	nextSimEvent: function() {
		if(this.state!='over' && this.simEvents.length) {
			this.selection = null;
			var self = this;
			if(!this.applyEvent(this.simEvents.shift()))
				setTimeout(function() { self.nextSimEvent(); }, 0);
		}
		else {
			var self = this;
			// todo, roundtrip may be avoided if events are complete
			this.sim.getSituation(this.party, null, function(data) { self.handleSituation(data); });
		}
	},

	applyEvent: function(evt) {
		var self = this;
		switch(evt.type) {
		case 'move':
			console.log('event', evt);
			var unit = this.units[evt.unit];
			if(!unit)
				break;
			unit.x = evt.from_x;
			unit.y = evt.from_y;

			if(!this.isInsideViewport(unit, 2))
				this.viewCenter(unit.x, unit.y);

			unit.animation = new AnimationMove(this.time, unit, {x:evt.to_x, y:evt.to_y},
				function(unit, evt) {
					delete self.mapView.get(evt.from_x, evt.from_y).unit;
					unit.x = evt.to_x;
					unit.y = evt.to_y;
					self.mapView.get(unit.x, unit.y).unit = unit;
					self.nextSimEvent();
				}, evt);
			return true;

		case 'combat':
			console.log('event', evt);
			var winner = this.units[evt.winner];
			if(winner)
				this.notify(MD.Party[winner.party.id].name+' '+winner.type.name+' prevails at ('+evt.x+','+evt.y+')', 4.0);
			var looser = this.units[evt.looser];
			if(!looser)
				break;
			if(looser == this.selUnit)
				this.selUnit = null;

			if(!this.isInsideViewport(evt, 1))
				this.viewCenter(evt.x, evt.y);
			looser.animation = new AnimationExplode(this.time, looser, function(unit) {
				looser.state = 'dead';
				self.nextSimEvent();
			});
			return true;

		case 'capture': {
			console.log('event', evt);
			var tile = this.mapView.get(evt.x, evt.y);
			tile.party = evt.party;
			tile.production = 'inf';
			tile.progress = -1;
			this.notify(MD.Party[evt.party].name+' captures objective at ('+evt.x+','+evt.y+')', 4.0);

			if(!this.isInsideViewport(evt, 1))
				this.viewCenter(evt.x, evt.y);
			this.redrawMap = true;
			return false;
		}
		case 'gameOver': {
			console.log('event', evt);
			this.switchState('over');
			var msg = 'GAME OVER!<br/>And the winner is... '+MD.Party[evt.winners[0]].name;
			var self = this;
			this.modalPopup(msg, ["OK"], function() { self.close(); } );
			return false;
		}
		case 'turn':
			console.log('event', evt);
			this.updateProduction(evt.turn - this.turn);
			this.turn = evt.turn;
			return false;
		
		case 'contact':
			console.log('event', evt);
			var tile = this.mapView.get(evt.x, evt.y);
			tile.unit = this.units[evt.unit.id] = new Unit(evt.unit);
			this.redrawMap = true;
			return false;

		case 'contactLost':
			console.log('event', evt);
			var tile = this.mapView.get(evt.x, evt.y);
			if(tile.unit && tile.unit.id === evt.unit.id)
				delete tile.unit;
			delete this.units[evt.unit.id];
			this.redrawMap = true;
			return false;

		case 'production':
		case 'productionBlocked':
		case 'blocked':
			// todo
		default:
			console.warn('unhandled sim event', evt);
		}
		return false;
	},

	switchState: function(state, params) {
		if(state==this.state || this.state=='over')
			return;

		this.toggleToolbar('main');
		switch(state) {
		case 'input': {
			var selUnitId = this.selUnit ? this.selUnit.id : 0;
			this.selection = null;
			this.redrawMap = true;
			this.selUnit = selUnitId ? this.units[selUnitId] : null;
			if(this.selUnit)
				this.selUnit.animation = new AnimationSelected(this.time, this.selUnit);
			else
				this.cursor = null;
			this.btnMain.setMode('fwd').setBackground(MD.Party[this.party].color);
			var msg = 'turn '+this.turn+' '+MD.Party[this.party].name;
			if(this.turn==1)
				msg += ' &nbsp; join id: '+this.sim.getMatchId();
			this.displayStatus(msg);
			break;
		}

		case 'waiting':
			this.btnMain.setMode('spinner');
			this.displayStatus('turn '+this.turn+', waiting for events...');
			this.deselectUnit();
			break;

		case 'replay':
			this.btnMain.setMode('pause');
			this.displayStatus('turn '+this.turn);
			this.nextSimEvent();
			break;
		
		case 'over': {
			this.selUnit = null;
			if(localStorage)
				delete localStorage.pelagium;
			break;
		}
		default:
			return console.error('unhandled application state', state);
		}
		this.state = state;
	},

	displayStatus: function(msg) {
		document.getElementById("status").innerHTML = msg;
	},
	notify: function(msg, duration) {
		document.getElementById("status").innerHTML = msg;
		if(duration) {
			setTimeout(function() { 
				var elem = document.getElementById("status");
				if(elem.innerHTML == msg)
					elem.innerHTML = '';
			}, duration*1000);
		}
	},
	modalPopup: function(msg, choices, callback) {
		var popup = document.getElementById('popup');
		if(!msg) {
			popup.style.display = 'none';
			return;
		}
		this.toggleMenu(false);
		popup.firstElementChild.firstElementChild.innerHTML = msg;

		var ul = popup.firstElementChild.lastElementChild;
		ul.innerHTML = '';

		var items = [];
		for(var i=0; i<choices.length; ++i) {
			var item = document.createElement('li');
			item.appendChild(document.createTextNode(choices[i]));
			item.dataset.id = i;
			item.onclick = function(event) {
				popup.style.display = 'none';
				if(callback)
					callback(event.target.dataset.id);
			}
			ul.appendChild(item);
			items.push(item);
		}
		eludi.click2touch(items);
		popup.style.display = '';
	}
}

function main(params) {
	var sim = new SimProxy(params, function(data, sim) {
		for(var key in data)
			params[key] = data[key];
		client.init(params, sim);
	});
}
