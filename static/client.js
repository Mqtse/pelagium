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
			dc.strokeUnit(toolId, sz,sz, sz/6, 'white');
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

// --- client ------------------------------------------------------
client = {
	settings: {
		cellHeight:36,
		scales: [ 18, 26, 36, 52, 72 ]
	},
	init: function(credentials, sim) {
		this.background = document.getElementById('background');
		this.background.dc = extendCanvasContext(this.background.getContext("2d"));
		this.foreground = document.getElementById('foreground');
		this.foreground.dc = extendCanvasContext(this.foreground.getContext("2d"));
		this.vp = { x:0, y:0, width:1, height:1 };
		this.cellMetrics = MapHex.calculateCellMetrics(this.settings.cellHeight);
		this.resize();

		var self = this;
		window.onresize=function() { self.resize(); }
		eludi.addPointerEventListener(this.foreground, function(event) { self.handlePointerEvent(event); });
		eludi.addWheelEventListener(function(event) { self.viewZoomStep(-event.deltaY, event.x, event.y); });
		eludi.addKeyEventListener(window, function(event) { self.handleKeyEvent(event); });

		this.state = 'init';
		this.sim = sim;
		this.parties = credentials.parties || {};
		delete credentials.parties;
		this.credentials = credentials;
		this.party = credentials.party;
		this.mapView = null;
		this.redrawMap = true;
		this.fov = null; // field of vision
		this.units = {};
		this.selUnit = null;
		this.selection = null;
		this.cursor = null;
		this.pointerEventStartTime = 0;
		this.time = 0;
		this.tLastUpdate = new Date()/1000.0;
		this.tLastFps = this.tLastUpdate;
		this.frames = 0;
		this.orders = [];
		this.simEvents = [];
		this.turn = 1;
		this.cache = new Cache('pelagium/client', this.credentials.id);
		this.workers = [];
		this.renderer = new RendererAdhoc(
			this.foreground.dc, 2*this.settings.scales[this.settings.scales.length-1]);

		for(let id in this.parties) {
			let party = this.parties[id];
			if(party.mode==='AI')
				this.spawnAI(party.id);
		}

		this.btnMain = new ButtonController('#toolbar_main', function(evt) { self.handleUIEvent(evt); });
		this.btnMain.setMode('fwd').setBackground(MD.Party[this.party].color);
		document.getElementById('main_menu').addEventListener("click", function(event) {
			self.handleUIEvent({ type:event.target.dataset.id }); });
		document.getElementById('btn_menu').addEventListener("click", function(event) {
			self.handleUIEvent({ type:event.currentTarget.dataset.id }); });
		if(!document.fullscreenEnabled && !document.webkitFullscreenEnabled)
			document.querySelector('#main_menu > li[data-id="fullscreen"]').style.display = 'none';
		document.querySelector('#main_menu > li[data-id="exit"]').style.display = 'none';
		this.toolbarProduction = new ProductionController('#toolbar_production', MD.Party[this.party].color,
			function(unitType) { if(self.cursor) self.handleProductionInput(unitType, self.cursor.x, self.cursor.y); });
		this.toggleToolbar('main');
		eludi.click2touch();

		sim.getSimEvents(this.party, null, (data)=>{
			this.handleExternalEvents(data);
		});
		sim.getTerrain(this.party, null, (data)=>{
			if(!data)
				return this.modalPopup('no connection', ["OK"], ()=>{ this.close(); } );

			this.mapView = new MatrixHex(data);
			MapHex.finalizeAppearance(this.mapView);
			this.redrawMap = true;

			setTimeout(()=>{
				sim.getSituation(this.party, null, (data)=>{
					if(!data)
						return this.modalPopup('no connection', ["OK"], ()=>{ this.close(); } );
					this.handleSituation(data);
					this.viewCenterAtOwnUnits();
				});
			}, 10);
		});
		this.update();
	},

	close: function(saveMatch, params) {
		if(saveMatch && this.state!='over') {
			return this.modalPopup('resume id: '+this.credentials.id, ['OK'], ()=>{
				eludi.openUrl(baseUrl, params, false);
			});
		}
		eludi.openUrl(baseUrl, params, false);
	},

	resize: function(scaleOnly) {
		var reservedWidth=0, reservedHeight=0;
		if(!('offsetX' in this.vp)) {
			this.vp.offsetX = 0.5*this.cellMetrics.r;
			this.vp.offsetY = 0;
		}
		if(!scaleOnly) {
			this.background.width = this.foreground.width = window.innerWidth-reservedWidth;
			this.background.height = this.foreground.height = window.innerHeight-reservedHeight;
		}
		this.vp.width = Math.ceil(1.25+this.background.width/this.cellMetrics.w);
		this.vp.height = Math.ceil(1.5+this.background.height/this.cellMetrics.h);
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
		var offsetX = this.vp.offsetX-0.75*this.cellMetrics.r;
		var cellX = Math.floor((event.x-offsetX) / this.cellMetrics.w) + this.vp.x;
		var offsetY = this.vp.offsetY+((cellX%2) ? 0 : -0.5*this.cellMetrics.h);
		var cellY = Math.floor((event.y-offsetY) / this.cellMetrics.h) + this.vp.y;

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
			if(this.panning || (Math.pow(dx,2)+Math.pow(dy,2) >= Math.pow(this.cellMetrics.r,2)) ) {
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
		case 'spinner':
			return this.sim.postOrders(this.party, [{type:'forceEvaluate'}], this.turn); // only devMode
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
		case "capitulate":
			return this.capitulate();
		case "exit":
			return this.close(false, this.outcome);
		case "joinCredentials":
			return this.modalPopup('join id: '+this.credentials.match, ['OK']);
		case "spawnAI":
			return this.spawnAI();
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

		this.addOrder({ type:'production', unit:unitType, x:x, y:y });
		tile.production = unitType;
		tile.progress = 0;
		this.toolbarProduction.setProduction(unitType, 0.0);
	},

	handleMapInput: function(type, cellX, cellY) {
		if(this.state!='input')
			return;
		this.cursor = { x:cellX, y:cellY };
		if(this.selUnit && this.isSelected(cellX, cellY) && !this.selUnit.origin
			&& !(this.selUnit.animation && this.selUnit.animation.type=='move'))
		{
			this.toggleToolbar('main');
			return this.moveUnit(this.selUnit, cellX, cellY);
		}

		var tile = this.mapView.get(cellX, cellY);
		if(!tile)
			return;

		if(tile.terrain == MD.OBJ && tile.party == this.party)
			this.toggleToolbar('production');
		else
			this.toggleToolbar('main');

		if(!tile.unit || (this.selUnit == tile.unit))
			this.deselectUnit();
		else
			this.selectUnit(tile.unit);

		var msg = '('+cellX+','+cellY+') ';
		if(tile.party)
			msg += MD.Party[tile.party].name+' ';
		msg += MD.Terrain[tile.terrain].name;
		if(tile.unit) {
			msg += ', ' + tile.unit.party.name + ' ' + tile.unit.type.name;
			if(tile.unit.origin)
				msg += ', moved';
		}

		this.displayStatus(msg);
		this.draw(true);
	},

	viewZoomStep: function(delta, centerX, centerY) {
		var i, scales = this.settings.scales;
		for(i=0; i<scales.length; ++i) 
			if(this.cellMetrics.h==scales[i])
				break;
		var scale = this.cellMetrics.h;
		if(delta<0 && i>0)
			scale = scales[i-1];
		else if(delta>0 && i+1<scales.length)
			scale = scales[i+1];
		if(this.cellMetrics.h != scale) {
			var factor = scale / this.cellMetrics.h;
			if(centerX===undefined)
				centerX = this.background.width/2;
			if(centerY===undefined)
				centerY = this.background.height/2;
			this.viewZoom(factor, centerX, centerY);
		}
	},

	viewZoom: function(factor, centerX, centerY, deltaX, deltaY) {
		var scales = this.settings.scales;
		var scale = factor * this.cellMetrics.h;
		var scaleMin = scales[0], scaleMax = scales[scales.length-1];
		if(scale < scaleMin)
			scale = scales[0];
		else if(scale > scaleMax)
			scale = scaleMax;
		if(scale == this.cellMetrics.h)
			return;
		var dx = centerX * (factor-1.0) + (deltaX!==undefined ? deltaX : 0);
		var dy = centerY * (factor-1.0) + (deltaY!==undefined ? deltaY : 0);
		this.cellMetrics = MapHex.calculateCellMetrics(scale);
		this.resize(true);
		this.viewPan(dx, dy);
	},

	viewPan: function(dX, dY) {
		var vp = this.vp;
		var cm = this.cellMetrics;
		vp.offsetX -= dX;
		vp.offsetY -= dY;
		vp.x -= (vp.offsetX>=0) ? 
			Math.floor(vp.offsetX / cm.w) : Math.ceil(vp.offsetX / cm.w);
		vp.y -= (vp.offsetY>=0) ?
			Math.floor(vp.offsetY / cm.h) : Math.ceil(vp.offsetY / cm.h);
		vp.offsetX %= cm.w;
		vp.offsetY %= cm.h;
		if(vp.offsetX>0.5*cm.r) {
			vp.offsetX -=cm.w;
			--vp.x;
		}
		if(vp.offsetY>0) {
			vp.offsetY -=cm.h;
			--vp.y;
		}
		this.redrawMap = true;
	},

	viewCenter: function(x, y) {
		this.vp.x = Math.round(x-this.vp.width/2);
		this.vp.y = Math.round(y-this.vp.height/2);
		this.redrawMap = true;
	},
	viewCenterAtOwnUnits: function() {
		var cx=0, cy=0, numUnits=0;
		for(var id in this.units) {
			var unit = this.units[id];
			if(unit.party.id!=this.party)
				continue;
			cx += unit.x;
			cy += unit.y;
			++numUnits;
		}
		if(numUnits) {
			cx /= numUnits;
			cy /= numUnits;
			this.viewCenter(Math.round(cx), Math.round(cy));
		}
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
		if(this.selUnit == unit || (unit && this.party != unit.party.id) || unit.origin)
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

	addOrder: function(order) {
		this.orders.push(order);
		this.cache.setItem('/orders', { turn:this.turn, orders:this.orders });
		console.log('order', order);
	},
	dispatchOrders: function() {
		if(this.state!='input')
			return;
		this.sim.postOrders(this.party, this.orders, this.turn);
		this.cache.removeItem('/orders');
		this.orders = [];
		for(var id in this.units) {
			var unit = this.units[id];
			unit.animation = null;
			if(!unit.origin)
				continue;
			unit.x = unit.origin.x;
			unit.y = unit.origin.y;
			delete unit.origin;
		}
		this.switchState('waiting');
	},
	restoreOrders: function() {
		var cachedOrders = this.cache.getItem('/orders');
		if(!cachedOrders)
			return;
		if(cachedOrders.turn != this.turn)
			return this.cache.removeItem('/orders');
		this.orders = cachedOrders.orders;
		this.orders.forEach(function(order, i) {
			if(order.type=='production') {
				var tile = this.mapView.get(order.x, order.y);
				if(!tile || tile.terrain!=MD.OBJ || tile.party != this.party || !(order.unit in MD.Unit))
					return;
				tile.production = order.unit;
				tile.progress = 0;
			}
			else if(order.type=='move') {
				var origin = this.mapView.get(order.from_x, order.from_y);
				var unit = origin.unit;
				if(!unit || unit.id != order.unit || this.party != unit.party.id)
					return;
				delete origin.unit;
				this.mapView.get(order.to_x, order.to_y).unit = unit;
				this.displayUnitDestination(unit, order);
			}
		}, this);
	},

	moveUnit: function(unit, x, y) {
		var path = unit.getPath(this.mapView, x,y);
		if(!path.length)
			return;
		var order = { type:'move', unit:unit.id, from_x:unit.x, from_y:unit.y, to_x:x, to_y:y };
		this.addOrder(order);

		this.selection = this.selUnit = null;
		delete this.mapView.get(unit.x, unit.y).unit;
		this.mapView.get(x, y).unit = unit;

		// animate until unit is drawn at its new destination:
		unit.animation = new AnimationMove(this.time, unit, path, (unit, order)=>{
			this.displayUnitDestination(unit, order);
		}, order);
	},
	displayUnitDestination: function(unit, order) {
		unit.origin = { x:unit.x, y:unit.y };
		unit.x = order.to_x;
		unit.y = order.to_y;
	},

	capitulate: function() {
		if(this.state == 'over' || this.state=='init')
			return;
		this.modalPopup("really surrender?", ["yes", "no"], (result)=>{
			if(result==1)
				return;
			this.orders = [{ type:'capitulate', party:this.party }];
			this.state='input';
			this.dispatchOrders();
		});
	},


	drawUnit: function(dc, unit) {
		if(unit.state=='dead')
			return;

		var x = unit.x-this.vp.x, y = unit.y-this.vp.y;
		var w, h;
		var scale = w = h = this.cellMetrics.r;
		var opacity = 1.0;
		var offsetOdd = (unit.x%2) ? 0.5*this.cellMetrics.h : 0;

		if(unit.animation && (this.state=='input' || this.state=='replay')) {
			var transf = { x:0.0, y:0.0, r:0.0, scx:1.0, scy:1.0, opacity:1.0 };
			unit.animation.transform(this.time, transf);
			x += transf.x;
			y += transf.y;
			w *= transf.scx;
			h *= transf.scy;
			opacity = transf.opacity;
		}

		x = x*this.cellMetrics.w + this.vp.offsetX - w/2;
		y = y*this.cellMetrics.h + this.vp.offsetY + offsetOdd - h/2;

		dc.save();
		dc.globalAlpha = opacity;
		var symbolOpacity = 1.0;
		if(this.state=='input' && !unit.animation && !unit.origin && unit.party.id==this.party)
			symbolOpacity = Math.min(0.75 + Math.abs(this.time % 1.0 - 0.5), 1.0);
		this.renderer.drawUnit(unit.party.id, unit.type.id, x,y,w,h, symbolOpacity);
		dc.restore();
	},

	drawSelTile: function(dc, tile) {
		var x = tile.x;
		var y = tile.y;
		var offsetY = this.vp.offsetY;
		if(x%2) 
			offsetY+=0.5*this.cellMetrics.h;
		var radius = this.cellMetrics.r/6;
		dc.circle((x-this.vp.x)*this.cellMetrics.w+this.vp.offsetX,
			(y-this.vp.y)*this.cellMetrics.h+offsetY, radius,
			{ fillStyle:tile.fillStyle ? tile.fillStyle : 'rgba(0,0,0, 0.33)' });
	},

	drawTile: function(x, y) {
		let viewport = { x:x, y:y, width:1, height:1,
			offsetX:this.vp.offsetX + (x-this.vp.x)*this.cellMetrics.w,
			offsetY:this.vp.offsetY + (y-this.vp.y)*this.cellMetrics.h };
		MapHex.draw(this.background, this.mapView, viewport, this.cellMetrics);
	},

	draw: function() {
		var fastMode = (this.panning || this.pinch) ? true : false;
		var vp = this.vp;

		this.foreground.dc.clearRect(0, 0, this.foreground.width, this.foreground.height);

		if(this.redrawMap && this.mapView) { // background:
			if(typeof this.redrawMap === 'object')
				this.drawTile(this.redrawMap.x, this.redrawMap.y);
			else {
				this.background.dc.clearRect(0, 0, this.background.width, this.background.height);
				MapHex.draw(this.background, this.mapView, vp, this.cellMetrics, this.fov, fastMode);
			}
			this.redrawMap = false;
		}
		if(fastMode)
			return;

		// foreground:
		dc = this.foreground.dc;
		let ownUnits = [];
		for(var id in this.units) {
			var unit = this.units[id];
			if(this.isInsideViewport(unit)) {
				if(unit.party.id == this.party)
					ownUnits.push(unit);
				else
					this.drawUnit(dc, unit);
			}
		}
		for(let i=ownUnits.length; i-->0; )
			this.drawUnit(dc, ownUnits[i]);

		if(this.selection)
			for(var i=this.selection.length; i--; )
				this.drawSelTile(dc, this.selection[i]);

		if(this.cursor && this.isInsideViewport(this.cursor) && (!this.selUnit || this.cursor.x!=this.selUnit.x || this.cursor.y!=this.selUnit.y)) {
			var x = this.cursor.x-vp.x;
			var y = this.cursor.y-vp.y;
			var offsetY = vp.offsetY + ((this.cursor.x%2) ? 0.5*this.cellMetrics.h : 0);
			var cx=x*this.cellMetrics.w+vp.offsetX, cy= y*this.cellMetrics.h+offsetY;
			var lineWidth = this.cellMetrics.r/8;
			var r = 0.5*this.cellMetrics.h-0.5*lineWidth;
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

		this.tLastUpdate = tNow;
		if(tNow-this.tLastFps<1.0)
			++this.frames;
		else {
			//this.displayStatus('fps: '+this.frames);
			this.frames = 1;
			this.tLastFps = tNow;
		}

		this.draw();
		requestAnimationFrame(()=>{ this.update(); });
	},

	handleExternalEvents: function(events) {
		let simEventsReceived = false;
		for(var i=0; i<events.length; ++i) {
			let evt = events[i];
			if(evt.category=='presence') {
				this.handlePresenceEvent(evt);
				continue;
			}
			this.simEvents.push(evt);
			simEventsReceived = true;
		}
		if(simEventsReceived)
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
		this.turn = parseInt(data.turn);
		if(this.turn>1)
			this.hideJoinCredentials();
		this.restoreOrders();

		if(data.state=='running')
			this.switchState(data.ordersReceived ? 'waiting' : 'input');
		else {
			let params;
			if(data.state=='over' && this.state!='over') {
				this.modalPopup('GAME OVER.', ["OK"]);
				params = { winners:data.winners, loosers:data.loosers, stats:data.stats };
			}
			this.switchState(data.state, params);
		}
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
			if(!this.renderSimEvent(this.simEvents.shift()))
				setTimeout(()=>{ this.nextSimEvent(); }, 0);
		}
		else // todo, roundtrip may be avoided if events are complete
			this.sim.getSituation(this.party, null, (data)=>{ this.handleSituation(data); });
	},

	renderSimEvent: function(evt) {
		let unit = ('unit' in evt) ? evt.unit : null;
		if(unit!==null&&(typeof evt.unit!='object')) {
			unit = this.units[unit];
			if(!unit || unit.state=='dead')
				return console.error('event refers to unknown unit:', evt);
		}

		switch(evt.type) {
		case 'retreat':
		case 'move': {
			console.log('event', evt);
			unit.x = evt.from_x;
			unit.y = evt.from_y;

			if(evt.type=='retreat')
				this.displayStatus(MD.Party[unit.party.id].name+' '+unit.type.name+' retreats');
			
			if(!this.isInsideViewport(unit, 2))
				this.viewCenter(unit.x, unit.y);

			unit.animation = new AnimationMove(this.time, unit, {x:evt.to_x, y:evt.to_y},
				(unit, evt)=>{
					delete this.mapView.get(evt.from_x, evt.from_y).unit;
					unit.x = evt.to_x;
					unit.y = evt.to_y;
					this.mapView.get(unit.x, unit.y).unit = unit;
					this.nextSimEvent();
				}, evt);
			return true;
		}
		case 'support': {
			console.log('event', evt);
			unit.animation = new AnimationSupport(this.time, unit, evt, unit=>{
				this.nextSimEvent();
			});
			return true;
		}
		case 'combat': {
			console.log('event', evt);
			var winner = this.units[evt.winner];
			if(winner)
				this.notify(MD.Party[winner.party.id].name+' '+winner.type.name+' prevails at ('+evt.x+','+evt.y+')', 4.0);
			if(!this.isInsideViewport(evt, 1))
				this.viewCenter(evt.x, evt.y);
			return false;
		}
		case 'surrender': {
			console.log('event', evt);
			if(unit == this.selUnit)
				this.selUnit = null;

			unit.animation = new AnimationExplode(this.time, unit, (unit)=>{
				unit.state = 'dead';
				this.nextSimEvent();
			});
			return true;
		}
		case 'capture': {
			console.log('event', evt);
			var tile = this.mapView.get(evt.x, evt.y);
			tile.party = evt.party;
			tile.production = 'inf';
			tile.progress = -1;
			this.notify(MD.Party[evt.party].name+' captures objective at ('+evt.x+','+evt.y+')', 4.0);

			if(!this.isInsideViewport(evt, 1))
				this.viewCenter(evt.x, evt.y);
			this.redrawMap = {x:evt.x, y:evt.y};
			return false;
		}
		case 'gameOver': {
			console.log('event', evt);
			this.switchState('over', evt);

			var msg = 'GAME OVER!<br/>And the winner';
			msg += (evt.winners.length==1) ? ' is...' : 's are...';
			for(let i=0; i<evt.winners.length; ++i)
				msg += ' '+MD.Party[evt.winners[i]].name;

			this.modalPopup(msg, ["OK"]);
			return false;
		}
		case 'turn': {
			console.log('event', evt);
			this.updateProduction(evt.turn - this.turn);
			this.turn = parseInt(evt.turn);
			return false;
		}
		case 'contact': {
			console.log('event', evt);
			var tile = this.mapView.get(evt.x, evt.y);
			tile.unit = this.units[evt.unit.id] = new Unit(evt.unit);
			return false;
		}
		case 'contactLost': {
			console.log('event', evt);
			var tile = this.mapView.get(evt.x, evt.y);
			if(tile.unit && tile.unit.id === evt.unit)
				delete tile.unit;
			delete this.units[evt.unit];
			return false;
		}
		case 'capitulate':
		case 'production':
		case 'productionBlocked':
		case 'blocked':
			break;
		default:
			console.warn('unhandled sim event', evt);
		}
		return false;
	},

	handlePresenceEvent: function(evt) {
		if(evt.type=='join' && !(evt.party in this.parties)) {
			let party = this.parties[evt.party] = {};
			if(evt.name)
				party.name = evt.name;
			if(evt.mode)
				party.mode = evt.mode;
			let name = evt.name || 'opponent';
			this.displayStatus(name+' has joined as ' + MD.Party[evt.party].name);
			this.hideJoinCredentials();
		}
		console.log('presence event type:', evt.type, 'party:', evt.party);
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

			if(this.turn==1) {
				let numParties = 0;
				for(let id in this.parties) {
					if(id == this.credentials.party)
						continue;
					msg += (numParties++) ? ', ' : ' &nbsp; co-players:';
					let name = this.parties[id].name;
					if(name && name.length)
						msg += ' '+name+' ('+MD.Party[id].name+')';
					else
						msg += ' '+MD.Party[id].name;
				}
				if(!numParties)
					msg += ' &nbsp; join id: '+this.credentials.match;
				else
					this.hideJoinCredentials();
			}
			this.displayStatus(msg);
			break;
		}

		case 'waiting':
			this.btnMain.setMode('spinner');
			this.displayStatus('turn '+this.turn+', waiting for events...');
			this.deselectUnit();
			break;

		case 'replay':
			this.cursor = null;
			this.btnMain.setMode('pause');
			this.displayStatus('turn '+this.turn);
			this.nextSimEvent();
			break;

		case 'over': {
			this.selUnit = null;
			if(localStorage)
				delete localStorage.pelagium;
			this.outcome = { screen:'over', party:this.credentials.party,
				winners:params.winners, loosers:params.loosers, stats:params.stats };

			this.btnMain.setMode('exit');
			this.hideJoinCredentials();
			document.querySelector('#main_menu > li[data-id="exit"]').style.display = '';
			document.querySelector('#main_menu > li[data-id="suspend"]').style.display = 'none';
			document.querySelector('#main_menu > li[data-id="capitulate"]').style.display = 'none';
			this.displayStatus('GAME OVER.');
			break;
		}
		default:
			return console.error('unhandled application state', state);
		}
		this.state = state;
	},

	spawnAI: function(id) {
		let ai = new Worker('/static/ai.js');
		this.workers.push(ai);
		ai.onmessage = (msg)=>{
			let evt = msg.data.type;
			let data = msg.data.data;
			if(evt=='credentials') {
				console.log('AI opponent has joined as '+MD.Party[data.party].name);
			}
			else if(evt=='error') {
				this.displayStatus('AI ERROR: '+data);
			}
		}
		ai.postMessage({ cmd:id?'resume':'join', id:id?id:this.credentials.match });
		this.toggleMenu(false);
	},

	hideJoinCredentials: function() {
		document.querySelector('#main_menu > li[data-id="spawnAI"]').style.display = 'none';
		document.querySelector('#main_menu > li[data-id="joinCredentials"]').style.display = 'none';
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
	var sim = new SimProxy(params, (credentials, sim)=>{
		if(credentials && sim)
			client.init(credentials, sim);
		else
			client.close();
	});
	sim.on('error', (evt, msg)=>{
		client.modalPopup(msg, ['OK'], function(id) { client.close(); });
	});
	sim.on('warn', (evt, msg)=>{ client.displayStatus(msg); });
}
window.addEventListener("load", ()=>{ 
	main(eludi.paramsRequest());
});
