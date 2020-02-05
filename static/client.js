function ProductionController(selector, unitColor, callback) {
	var element=document.querySelector(selector);

	this.setProduction = function(id, progress=0.0) {
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
				const fraction = Math.min(progress / MD.Unit[id].cost, 1.0);
				dc.circle(cx,cy, canvas.width*0.4, {fillStyle:'rgba(0,0,0,0.5)'});

				dc.lineWidth = canvas.width*0.1;
				dc.beginPath();
				dc.strokeStyle='white';
				dc.arc(cx,cy, canvas.width*0.45, 1.5*Math.PI, 1.5*Math.PI+2*Math.PI*fraction, false);
				dc.stroke();
				dc.strokeStyle='rgba(255,255,255,0.33)';
				dc.arc(cx,cy, canvas.width*0.45, 1.5*Math.PI+2*Math.PI*fraction, 1.5*Math.PI+2*Math.PI, false);
				dc.closePath();
				dc.stroke();
				this.production = id;
			}
			var sz = canvas.width/2;
			dc.save();
			dc.translate(0.5*(canvas.width-sz), 0.5*(canvas.height-sz));
			dc.beginPath();
			dc.rect(0,0, sz,sz);
			dc.clip();
			dc.fillStyle = unitColor;
			dc.fillRect(0,0, sz,sz);
			dc.strokeUnit(toolId, sz,sz, sz/6, 'white');
			dc.restore();

			const Unit = MD.Unit[toolId];
			const turns = (isSelected && progress) ? (Unit.cost-progress) : Unit.cost;
			child.title = Unit.name + ', ' + turns + (turns==1 ? ' turn' : ' turns');
		}
		return this;
	}
	this.setDelta = function(delta) {
		var i=0;
		for(var end=element.children.length; i<end; ++i) {
			var child = element.children[i];
			var toolId = child.dataset.id;
			if(toolId == this.production)
				break;
		}
		i = (i+element.children.length+delta)%element.children.length;
		var toolId = element.children[i].dataset.id;
		this.setProduction(toolId);
		return toolId;
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
	this.visible = function() {
		return element.style.display != 'none';
	}

	let pixelRatio = window.devicePixelRatio || 1;

	for(let id in MD.Unit) {
		const Unit = MD.Unit[id];
		let item = document.createElement('li');
		item.dataset.id = id;
		item.title = Unit.name+', '+Unit.cost+' turns';

		let canvas = document.createElement('canvas');
		canvas.width = canvas.height = 48 * pixelRatio;
		canvas.style.width = canvas.style.he9ght = '100%';
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
	loadPreferences: function() {
		if(localStorage && localStorage.pelagium_prefs) try {
			return JSON.parse(localStorage.pelagium_prefs);
		} catch(err) {
			console.error(err);
		}
		return {};
	},
	savePreferences: function(prefs={}) {
		for(let key in prefs)
			this.preferences[key] = prefs[key];
		if(localStorage)
			localStorage.setItem('pelagium_prefs', JSON.stringify(this.preferences));
	},
	init: function(credentials, sim) {
		this.background = document.getElementById('background');
		this.background.dc = extendCanvasContext(this.background.getContext("2d"));
		this.foreground = document.getElementById('foreground');
		this.foreground.dc = extendCanvasContext(this.foreground.getContext("2d"));
		this.vp = {
			x:0, y:0, width:1, height:1, offsetX:0, offsetY:0, cellMetrics:null,
			mapToScreen: function(pos) {
				let x = pos.x-this.x;
				let y = pos.y-this.y;
				let offsetY = this.offsetY + ((pos.x%2) ? 0.5*this.cellMetrics.h : 0);
				return { x:x*this.cellMetrics.w+this.offsetX, y:y*this.cellMetrics.h+offsetY };
			},
			screenToMap: function(screen) {
				let offsetX = this.offsetX-0.75*this.cellMetrics.r;
				let cellX = Math.floor((screen.x-offsetX) / this.cellMetrics.w) + this.x;
				let offsetY = this.offsetY+((cellX%2) ? 0 : -0.5*this.cellMetrics.h);
				let cellY = Math.floor((screen.y-offsetY) / this.cellMetrics.h) + this.y;
				return { x:cellX, y:cellY };
			}
		};
		this.resize();

		window.onresize = ()=>{ this.resize(); }
		window.oncontextmenu = (e)=>{ return false; }
		eludi.addWheelEventListener((event)=>{ this.viewZoomStep(-event.deltaY, event.x, event.y); });
		eludi.addKeyEventListener(window, (event)=>{ this.handleKeyEvent(event); });

		this.state = 'init';
		this.preferences = this.loadPreferences();
		this.sim = sim;
		this.parties = credentials.parties || {};
		delete credentials.parties;
		this.credentials = credentials;
		this.party = this.foregroundParty = credentials.party;
		this.isDemo = credentials.mode === 'demo';
		this.isTutorial = credentials.mode === 'tutorial';
		this.numPartiesMax = 2;
		this.mapView = null;
		this.redrawMap = true;
		this.showInfo = ('showInfo' in this.preferences) ? this.preferences.showInfo : true;
		this.toggleInfo(this.showInfo);
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
		this.eventListeners = {};
		this.dbgChannel = null
		this.turn = 1;
		this.consistencyState = { turn:this.turn, ordersSent:false, state:this.state };
		this.cache = new Cache((this.isDemo || this.isTutorial) ? null : 'pelagium/client', this.credentials.id);
		this.cache.removeItem('/sim');
		if(credentials.mode=='start')
			this.cache.removeItem('/orders');
		this.workers = [];
		this.renderer = new RendererAdhoc(
			this.foreground.dc, 2*this.settings.scales[this.settings.scales.length-1]);

		let aiOpponents = [];
		for(let id in this.parties) {
			let party = this.parties[id];
			if(party.mode==='AI')
				aiOpponents.push(party);
		}
		if(aiOpponents.length && !this.isTutorial)
			this.spawnAI(aiOpponents);
		this.autoPilot = this.isDemo ? this.spawnAI(this.credentials.id, this.party, true) : null;

		let mapReceptor = this.isTutorial ?
			document.getElementById('tut_map') : this.foreground;
		eludi.addPointerEventListener(mapReceptor, (event)=>{ this.handlePointerEvent(event); });
		this.btnMain = new ButtonController('#toolbar_main', (evt)=>{
			if(this.isTutorial)
				this.emit(evt.type, evt); // handle by tutorial
			else
				this.handleUIEvent(evt);
		});
		this.btnMain.setMode('fwd').setBackground(MD.Party[this.party].color);
		document.getElementById('main_menu').addEventListener("click", (event)=>{
			this.handleUIEvent({ type:event.target.dataset.id }); });
		document.getElementById('btn_menu').addEventListener("click", (event)=>{
			this.handleUIEvent({ type:event.currentTarget.dataset.id }); });
		if(!document.fullscreenEnabled && !document.webkitFullscreenEnabled)
			this.hideMenuItem('fullscreen');
		this.toolbarProduction = new ProductionController('#toolbar_production', MD.Party[this.party].color,
			(unitType)=>{ if(this.cursor) this.handleProductionInput(unitType, this.cursor.x, this.cursor.y); });
		if(!this.isDemo && !this.isTutorial)
			this.hideMenuItem('exit');
		else
			this.hideMenuItem('joinCredentials').hideMenuItem('suspend').hideMenuItem('capitulate');
		this.toggleToolbar('main');
		eludi.click2touch();

		if(this.autoPilot)
			this.autoPilot.on('simEvents', (evt, data)=>{
				this.handleExternalEvents(data);
			});
		else
			sim.getSimEvents(this.party, this.consistencyState, (data)=>{
				if(!this.isSimOnClient)
					this.handleExternalEvents(data);
				else setTimeout(()=>{ this.handleExternalEvents(data); }, 0);
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
		const baseUrl = (document.referrer && document.referrer!=document.URL) ?
			document.referrer : 'index.html';
		const navigate = (!params || (location.protocol!='file:' && sessionStorage)) ?
			()=>{ 
				document.documentElement.style.background = 'black';
				if(params)
					sessionStorage['eludi_paramsRequest']=JSON.stringify(params);
				history.back();
			} :
			()=>{
				document.documentElement.style.background = 'black';
				eludi.openUrl(baseUrl, params, false);
			};

		if(saveMatch && this.state!='over') {
			if(!this.isSimOnClient)
				return this.modalPopup('resume id: '+this.credentials.id, ['OK'], navigate);
			this.cache.setItem('/sim', this.sim._serialize());
		}
		this.transition = new TransitionFade();
		setTimeout(navigate, 400);
	},

	on: function(event, callback) {
		if(!(event in this.eventListeners))
			this.eventListeners[event] = [];
		this.eventListeners[event].push(callback);
	},
	emit: function(event, data) {
		[event, '*'].forEach((key)=>{
			if(key in this.eventListeners) {
				let callbacks = this.eventListeners[key];
				for(let i=0; i<callbacks.length; ++i)
					callbacks[i](event, data);
			}
		});
	},

	resize: function(scaleOnly) {
		let width = window.innerWidth, height = window.innerHeight;
		if(navigator.standalone) { // mobile safari webapp hacks
			if(!('w' in this.resize)) {
				this.resize.w = screen.width;
				this.resize.h = screen.height;
			}
			if(Math.abs(window.orientation)===90) {
				width = Math.max(this.resize.w, this.resize.h);
				height = Math.max(window.innerHeight, Math.min(this.resize.w, this.resize.h)-20);
			}
			else {
				width = Math.min(this.resize.w, this.resize.h);
				height = Math.max(this.resize.w, this.resize.h)-20;
			}
		}

		if(this.vp.cellMetrics === null) {
			this.vp.cellMetrics = MapHex.calculateCellMetrics(this.settings.cellHeight);
			this.vp.offsetX = 0.5*this.vp.cellMetrics.r;
			this.vp.offsetY = 0;
		}
		if(!scaleOnly) {
			let pixelRatio = this.vp.pixelRatio = window.devicePixelRatio || 1;
			this.background.width = this.foreground.width = width * pixelRatio;
			this.background.height = this.foreground.height = height * pixelRatio;
			this.background.dc.scale(pixelRatio, pixelRatio);
			this.foreground.dc.scale(pixelRatio, pixelRatio);
		}
		this.vp.width = Math.ceil(1.25+width/this.vp.cellMetrics.w);
		this.vp.height = Math.ceil(1.5+height/this.vp.cellMetrics.h);
		this.redrawMap = true;
	},

	menuVisible: function() {
		var elem = document.getElementById('menus');
		return elem.style.display == '';
	},
	menuSetDelta: function(delta) {
		let allItems = document.getElementById('main_menu').children;
		let items=[], selIndex = -1;
		for(let i=0; i<allItems.length; ++i) {
			if(allItems[i].style.display=='none')
				continue;
			if(allItems[i].classList.contains('selected')) {
				selIndex = items.length;
				allItems[i].classList.remove('selected');
			}
			items.push(allItems[i]);
		}
		if(selIndex == -1 && delta<=0)
			selIndex=0;
		selIndex = (selIndex+items.length+delta)%items.length;
		items[selIndex].classList.add('selected');
		console.log('menuSetDelta('+delta+') selIndex:', selIndex);
	},
	menuValue: function() {
		let items=document.getElementById('main_menu').children;
		for(let i=0; i<items.length; ++i)
			if(items[i].style.display!='none' && items[i].classList.contains('selected'))
				return items[i].dataset.id;
		return '';
	},
	toggleMenu: function(onOrOff) {
		var elem = document.getElementById('menus');
		if(onOrOff===undefined)
			elem.style.display = (elem.style.display=='none') ? '' : 'none';
		else
			elem.style.display = onOrOff ? '' : 'none';

		if(elem.style.display == '') {
			document.querySelectorAll('#main_menu > *').forEach((item)=>{
				item.classList.remove('selected');
			});
			document.getElementById('info_panel').style.display = 'none';
			this.btnMain.setFocus(false);
		}
		else if(this.showInfo)
			this.toggleInfo(true);
	},
	toggleInfo: function(isOn) {
		this.showInfo = isOn;
		var elem = document.getElementById('info_panel');
		elem.style.display = isOn ? '' : 'none';

		if(isOn)
			document.getElementById('menus').style.display = 'none';
		document.getElementById('toggleInfo').innerHTML
			= isOn ? 'hide unit info' : 'show unit info';

	},
	setInfo: function(content) {
		document.getElementById('info_panel').innerHTML = content ? content : '';
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
		switch(event.type) {
		case 'start':
			if(event.id==1) {
				this.pointerEventStartTime = Date.now();
				if(event.pointerType=='mouse') {
					this.prevX = event.x;
					this.prevY = event.y;
					this.panning = true;
				}
				else {
					if(!this.panning && !this.pinch)
						this.emit('fastDraw');
					this.panning = false;
					this.pinch = [{x:this.prevX, y:this.prevY}, {x:event.x, y:event.y}];
				}
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
				if(!dist0)
					return;
				var factor = dist1 / dist0;
				var centerX = Math.round((this.pinch[0].x+this.pinch[1].x)/2);
				var centerY = Math.round((this.pinch[0].y+this.pinch[1].y)/2);
				return this.viewZoom(factor, centerX, centerY, -dx/2, -dy/2);
			}
			var dx=this.prevX-event.x, dy=this.prevY-event.y;
			if(this.panning || (Math.pow(dx,2)+Math.pow(dy,2) >= Math.pow(this.vp.cellMetrics.r,2)) ) {
				this.prevX = event.x;
				this.prevY = event.y;
				if(!this.panning && !this.pinch)
					this.emit('fastDraw');
				this.panning = true;
				this.viewPan(dx, dy);
			}
			break;
		case 'end':
			if(event.id>1 || !this.pointerEventStartTime) // ignore right mouse button / multi-touch
				return;
			if(this.pinch || this.panning) {
				this.pinch = this.panning = false;
				this.redrawMap = true;
				this.emit('fullDraw');
			}
			else {
				let cell = this.vp.screenToMap(event);
				if(!this.isTutorial)
					this.handleMapInput('click', cell.x, cell.y);
				else
					this.emit('mapInput', {x:cell.x, y:cell.y});
			}
			this.pointerEventStartTime=0;
		}
	},

	handleModalPopupKeyEvent: function(event) {
		let choices = this.modalPopupChoices();
		switch(event.which || event.keyCode) {
		case 9: // tab
		case 27: // escape
		case 10009: // RETURN on Samsung remote control
			this.modalPopupTrigger(choices[choices.length-1].dataset.id);
			break;
		case 13: // enter
		case 32: // space
			if(choices.length==1)
				this.modalPopupTrigger(choices[0].dataset.id);
			break;
		case 37: // left
			if(choices.length==2)
				this.modalPopupTrigger(choices[0].dataset.id);
			break;
		case 39: // right
			if(choices.length==2)
				this.modalPopupTrigger(choices[choices.length-1].dataset.id);
			break;
		default:
			return;
		}
		event.preventDefault();
	},

	handleKeyEvent: function(event) {
		if(this.modalPopupVisible())
			return this.handleModalPopupKeyEvent(event);

		var currentCursor = ()=>{
			if(!this.cursor || !this.isInsideViewport(this.cursor, 1))
				this.cursor = { x:this.vp.x + Math.floor(this.vp.width/2),
					y:this.vp.y + +Math.floor(this.vp.height/2), visible:true };
			else
				this.cursor.visible = true;
			return this.cursor;
		}
		var which = event.which || event.keyCode;
		switch(which) {
		default:
			console.log(' key '+which+' down');
			return;
		case 9: // tab
		case 27: // escape
		case 10009: // RETURN on Samsung remote control
			if(this.menuVisible()) {
				this.toggleMenu(false);
				currentCursor();
			}
			else if(this.toolbarProduction.visible()) {
				eludi.switchToSibling('toolbar_main');
			}
			else if(this.btnMain.hasFocus()) {
				this.btnMain.setFocus(false);
				this.toggleMenu(true);
				this.menuSetDelta(0);
			}
			else {
				this.btnMain.setFocus(true);
				if(this.cursor)
					this.cursor.visible = false;
			}
			event.preventDefault();
			return;
		case 13: // enter
		case 32: // space
			if(this.btnMain.hasFocus())
				this.btnMain.trigger();
			else if(this.menuVisible()) {
				let evt = this.menuValue();
				if(evt)
					this.handleUIEvent({type:evt});
			}
			else if(!this.cursor || !this.cursor.visible)
				currentCursor();
			else if(!this.isTutorial)
				this.handleMapInput('click', this.cursor.x, this.cursor.y);
			event.preventDefault();
			break;
		case 33: // pgup
			return this.viewZoomStep(-1);
		case 34: // pgdown
			return this.viewZoomStep(1);
		case 37: // left
			if(!this.toolbarProduction.visible() && !this.menuVisible()) {
				--currentCursor().x;
				this.updateCursorInfo();
			}
			break;
		case 38: // up
			if(this.toolbarProduction.visible())
				this.handleProductionInput(this.toolbarProduction.setDelta(-1),
					this.cursor.x, this.cursor.y);
			else if(this.menuVisible())
				this.menuSetDelta(-1);
			else {
				--currentCursor().y;
				this.updateCursorInfo();
			}
			break;
		case 39: // right
			if(!this.toolbarProduction.visible() && !this.menuVisible()) {
				++currentCursor().x;
				this.updateCursorInfo();
			}
			break;
		case 40: // down
			if(this.toolbarProduction.visible())
				this.handleProductionInput(this.toolbarProduction.setDelta(+1),
					this.cursor.x, this.cursor.y);
			else if(this.menuVisible())
				this.menuSetDelta(+1);
			else {
				++currentCursor().y;
				this.updateCursorInfo();
			}
			break;
		case 122: // F11
			event.preventDefault();
			return eludi.toggleFullScreen();
		}
		if(this.cursor && !this.isInsideViewport(this.cursor, 1))
			this.viewCenter(this.cursor.x, this.cursor.y);
	},

	handleUIEvent: function(event) {
		switch(event.type) {
		case 'fwd':
			this.btnMain.setFocus(false);
			return this.dispatchOrders();
		case 'spinner':
			return this.sim.postOrders(this.party, {orders:[{type:'forceEvaluate'}],
				turn:this.turn});
		case 'pause':
			// todo
			break;
		case 'fullscreen':
			this.toggleMenu(false);
			return eludi.toggleFullScreen();
		case "suspend":
			return this.close(true);
		case "capitulate":
			return this.capitulate();
		case "exit":
			return this.close(false, this.outcome);
		case "joinCredentials":
			return this.modalPopup('join id: '+this.credentials.match, ['OK']);
		case 'toggleMenu':
			return this.toggleMenu();
		case 'toggleInfo':
			this.toggleInfo(!this.showInfo);
			this.savePreferences({showInfo: this.showInfo});
			return this.toggleMenu(false);
		default:
			console.error('unhandled UI event', event);
		}
	},

	handleProductionInput: function(unitType, x, y) {
		if(this.state!='input')
			return;
		let tile = this.mapView.get(x, y);
		if(!tile || tile.terrain!=MD.OBJ || tile.party != this.party || tile.production==unitType || !(unitType in MD.Unit))
			return;

		this.addOrder({ type:'production', unit:unitType, x:x, y:y });
		tile.production = unitType;
		tile.progress = 0;
		this.toolbarProduction.setProduction(unitType);
		this.displayStatus(MD.Unit[unitType].name+', '+MD.Unit[unitType].cost+' turns');
	},

	handleMapInput: function(type, cellX, cellY) {
		if(this.state!='input')
			return;
		this.btnMain.setFocus(false);
		this.cursor = { x:cellX, y:cellY, visible:true };
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

		if(this.selUnit && this.selUnit == tile.unit) {
			this.deselectUnit();
			this.setInfo();
		}
		else {
			if(!tile.unit || (this.selUnit == tile.unit))
				this.deselectUnit();
			else
				this.selectUnit(tile.unit);
			this.updateCursorInfo();
		}
		this.draw(true);
	},

	viewZoomStep: function(delta, centerX, centerY) {
		var i, scales = this.settings.scales;
		for(i=0; i<scales.length; ++i)
			if(this.vp.cellMetrics.h==scales[i])
				break;
		var scale = this.vp.cellMetrics.h;
		if(delta<0 && i>0)
			scale = scales[i-1];
		else if(delta>0 && i+1<scales.length)
			scale = scales[i+1];
		if(this.vp.cellMetrics.h != scale) {
			var factor = scale / this.vp.cellMetrics.h;
			if(centerX===undefined)
				centerX = this.background.width/2;
			if(centerY===undefined)
				centerY = this.background.height/2;
			this.viewZoom(factor, centerX, centerY);
			this.emit('fullDraw');
		}
	},

	viewZoom: function(factor, centerX, centerY, deltaX, deltaY) {
		var scales = this.settings.scales;
		var scale = factor * this.vp.cellMetrics.h;
		var scaleMin = scales[0], scaleMax = scales[scales.length-1];
		if(scale < scaleMin)
			scale = scales[0];
		else if(scale > scaleMax)
			scale = scaleMax;
		if(scale == this.vp.cellMetrics.h)
			return;
		var dx = centerX * (factor-1.0) + (deltaX!==undefined ? deltaX : 0);
		var dy = centerY * (factor-1.0) + (deltaY!==undefined ? deltaY : 0);
		this.vp.cellMetrics = MapHex.calculateCellMetrics(scale);
		this.resize(true);
		this.viewPan(dx, dy);
	},

	viewPan: function(dX, dY) {
		var vp = this.vp;
		var cm = this.vp.cellMetrics;
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

	updateCursorInfo: function() {
		let tile = this.mapView.get(this.cursor.x, this.cursor.y);
		if(!tile)
			return;

		let msg = '('+this.cursor.x+','+this.cursor.y+') ';
		let info;

		if(!tile.unit) {
			if(tile.party)
				msg += MD.Party[tile.party].name+' ';
			const Terrain = MD.Terrain[tile.terrain];
			msg += Terrain.name;

			info = '<h1>'+Terrain.name+'</h1>'
				+ '<p>defense: &times;'+ Terrain.defend+'</p>'
				+ '<p>movement: '+ Terrain.move+'</p>'
				+ '<p>concealment: '+ Terrain.concealment+'</p>';
		}
		else {
			const Unit = tile.unit.type;
			msg += tile.unit.party.name + ' ' + Unit.name;
			if(tile.unit.origin)
				msg += ', moved';

			info = '<h1>'+Unit.name+'</h1>'
				+ '<p>attack: '+ Unit.attack+'</p>'
				+ '<p>defense: '+ Unit.defend+'</p>'
				+ '<p>moves: '+ Unit.move+'</p>'
				+ '<p>support: +'+ Unit.support+'</p>'
				+ '<p>supp. range: '+ Unit.range+'</p>';
		}

		this.displayStatus(msg);
		this.setInfo(info);
	},

	selectUnit: function(unit) {
		if(!unit || this.selUnit == unit || (this.party != unit.party.id))
			return;
		this.deselectUnit();
		this.selUnit = unit;
		if(!unit.origin) {
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

	allOwnUnitsHaveOrders: function() {
		for(var id in this.units) {
			var unit = this.units[id];
			if(unit.party.id == this.party && !unit.origin)
				return false;
		}
		return true;
	},

	addOrder: function(order) {
		this.orders.push(order);
		this.cache.setItem('/orders', { turn:this.turn, orders:this.orders });
		//console.log('order', order);
	},
	dispatchOrders: function(force=false) {
		if(!force && this.state!='input')
			return;
		this.sim.postOrders(this.party, {orders:this.orders, turn:this.turn});
		this.consistencyState.ordersSent = true;
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
				var unit = origin ? origin.unit : null;
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
			if(this.allOwnUnitsHaveOrders())
				this.btnMain.setFocus(true);
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
			this.dispatchOrders(true);
		});
	},


	drawUnit: function(dc, unit) {
		if(unit.state=='dead')
			return;

		var x = unit.x-this.vp.x, y = unit.y-this.vp.y;
		var w, h;
		var w = h = this.vp.cellMetrics.r;
		var opacity = 1.0;
		var offsetOdd = (unit.x%2) ? 0.5*this.vp.cellMetrics.h : 0;

		if(unit.animation && (this.state=='input' || this.state=='replay')) {
			var transf = { x:0.0, y:0.0, r:0.0, scx:1.0, scy:1.0, opacity:1.0 };
			unit.animation.transform(this.time, transf);
			x += transf.x;
			y += transf.y;
			w *= transf.scx;
			h *= transf.scy;
			opacity = transf.opacity;
		}

		x = x*this.vp.cellMetrics.w + this.vp.offsetX - w/2;
		y = y*this.vp.cellMetrics.h + this.vp.offsetY + offsetOdd - h/2;

		dc.save();
		dc.globalAlpha = opacity;
		var symbolOpacity = 1.0;
		if(this.state=='input' && !unit.animation && !unit.origin && unit.party.id==this.party)
			symbolOpacity = Math.min(0.75 + Math.abs(this.time % 1.0 - 0.5), 1.0);
		this.renderer.drawUnit(unit.party.id, unit.type.id, x,y,w,h, symbolOpacity);
		dc.restore();
	},

	drawSelTile: function(dc, tile) {
		var pos = this.vp.mapToScreen(tile);
		var radius = this.vp.cellMetrics.r/6;
		dc.circle(pos.x, pos.y, radius, { fillStyle:tile.fillStyle ? tile.fillStyle : 'rgba(0,0,0, 0.33)' });
	},

	drawTile: function(x, y) {
		let viewport = { x:x, y:y, width:1, height:1,
			offsetX:this.vp.offsetX + (x-this.vp.x)*this.vp.cellMetrics.w,
			offsetY:this.vp.offsetY + (y-this.vp.y)*this.vp.cellMetrics.h };
		MapHex.draw(this.background, this.mapView, viewport, this.vp.cellMetrics);
	},

	drawMapCircle: function(dc, pos, radius, style=undefined) {
		var center = this.vp.mapToScreen(pos);
		dc.circle(center.x, center.y, radius, style);
	},

	draw: function() {
		var fastMode = (this.panning || this.pinch) ? true : false;
		var vp = this.vp;

		this.foreground.dc.clearRect(0, 0, this.foreground.width/vp.pixelRatio, this.foreground.height/vp.pixelRatio);

		if(this.redrawMap && this.mapView) { // background:
			if(typeof this.redrawMap === 'object')
				this.drawTile(this.redrawMap.x, this.redrawMap.y);
			else {
				this.background.dc.clearRect(0, 0, this.background.width/vp.pixelRatio, this.background.height/vp.pixelRatio);
				MapHex.draw(this.background, this.mapView, vp, this.vp.cellMetrics, this.fov, fastMode);
			}
			this.redrawMap = false;
		}
		if(fastMode)
			return;

		// foreground:
		dc = this.foreground.dc;
		if(this.selUnit && this.selUnit.type.range) {
			const cellR = this.vp.cellMetrics.r;
			this.drawMapCircle(dc, this.selUnit, (this.selUnit.type.range-0.2)*cellR*2,
				{strokeStyle: 'rgba(255,255,255,0.5)', lineWidth:cellR/6, lineDash:[cellR/4,cellR/4]});
		}

		let foregroundUnits = [];
		for(var id in this.units) {
			var unit = this.units[id];
			if(this.isInsideViewport(unit)) {
				if(unit.party.id == this.foregroundParty)
					foregroundUnits.push(unit);
				else
					this.drawUnit(dc, unit);
			}
		}
		for(let i=foregroundUnits.length; i-->0; )
			this.drawUnit(dc, foregroundUnits[i]);

		if(this.selection)
			for(var i=this.selection.length; i--; )
				this.drawSelTile(dc, this.selection[i]);

		if(this.cursor && this.cursor.visible && this.isInsideViewport(this.cursor)
			&& (!this.selUnit || this.cursor.x!=this.selUnit.x || this.cursor.y!=this.selUnit.y))
		{
			var lineWidth = this.vp.cellMetrics.r/8;
			var r = 0.5*this.vp.cellMetrics.h-0.5*lineWidth;
			var deltaR = 0.07*r*Math.sin(this.time*1.5*Math.PI);
			this.drawMapCircle(dc, this.cursor, r+deltaR, {strokeStyle: 'white', lineWidth:lineWidth});
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
			else if(evt.category=='inconsistency') {
				this.handleInconsistencyEvent(evt);
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
		let newTurn = parseInt(data.turn);
		if(newTurn != this.turn) {
			this.orders = [];
			this.consistencyState.ordersSent = false;
		}
		this.consistencyState.turn =this.turn = newTurn;
		if(this.turn>1)
			this.hideMenuItem('joinCredentials');
		this.numPartiesMax = data.numPartiesMax;
		this.restoreOrders();

		if(data.state=='running') {
			this.switchState((data.ordersReceived || this.isDemo) ? 'waiting' : 'input');
			if(this.autoPilot)
				this.autoPilot.postMessage({ cmd:'postOrders' });
		}
		else {
			let params;
			if(data.state=='over' && this.state!='over') {
				params = { winners:data.winners, loosers:data.loosers, capitulated:data.capitulated, stats:data.stats };
				if(this.isDemo)
					this.close(false, this.outcome);
				else this.modalPopup('GAME OVER.', ["VIEW MAP", "EXIT"], (result)=>{
					if(result==1)
						this.close(false, this.outcome);
				});
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
		else {
			//console.groupEnd();
			// todo, roundtrip may be avoided if events are complete
			this.sim.getSituation(this.party, null, (data)=>{ this.handleSituation(data); });
		}
	},

	renderSimEvent: function(evt) {
		if(typeof evt != 'object')
			return console.error('malformed event:', evt);

		let unit = ('unit' in evt) ? evt.unit : null;
		if(unit!==null&&(typeof evt.unit!='object')) {
			unit = this.units[unit];
			if(!unit || unit.state=='dead')
				return console.warn('event refers to unknown unit:', evt);
		}

		switch(evt.type) {
		case 'retreat':
		case 'move': {
			//console.log('event', evt);
			unit.x = evt.from_x;
			unit.y = evt.from_y;

			if(evt.type=='retreat')
				this.displayStatus(MD.Party[unit.party.id].name+' '+unit.type.name+' retreats');

			if(!this.isInsideViewport(unit, 2))
				this.viewCenter(unit.x, unit.y);

			let dest = this.mapView.get(evt.to_x, evt.to_y);
			if(dest.terrain===MD.OBJ) { // try to show previous party
				let prevParty =-1;
				for(let i=0; i<this.simEvents.length; ++i) {
					let nextEvt = this.simEvents[i];
					if(nextEvt.x != evt.to_x || nextEvt.y != evt.to_y)
						continue;
					if(nextEvt.type=='capture') {
						prevParty = nextEvt.from;
						break;
					}
				}
				if(prevParty!==-1 && dest.party != prevParty) {
					dest.party = prevParty;
					if(!this.redrawMap)
						this.redrawMap = {x:evt.to_x, y:evt.to_y};
				}
			}

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
			//console.log('event', evt);
			unit.animation = new AnimationSupport(this.time, unit, evt, unit=>{
				this.nextSimEvent();
			});
			return true;
		}
		case 'combat': {
			//console.log('event', evt);
			var winner = this.units[evt.winner];
			if(winner)
				this.notify(MD.Party[winner.party.id].name+' '+winner.type.name+' prevails at ('+evt.x+','+evt.y+')', 4.0);
			if(!this.isInsideViewport(evt, 1))
				this.viewCenter(evt.x, evt.y);
			return false;
		}
		case 'surrender': {
			//console.log('event', evt);
			if(unit == this.selUnit)
				this.selUnit = null;

			unit.animation = new AnimationExplode(this.time, unit, (unit)=>{
				unit.state = 'dead';
				this.nextSimEvent();
			});
			return true;
		}
		case 'capture': {
			//console.log('event', evt);
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

			if(this.isDemo)
				setTimeout(()=>{ this.close(false, this.outcome); }, 2500);
			else this.modalPopup(msg, ["VIEW MAP", "EXIT"], (result)=>{
				if(result==1)
					this.close(false, this.outcome);
			});
			return false;
		}
		case 'turn': {
			console.log('event', evt);
			let newTurn = parseInt(evt.turn);
			if(newTurn != this.turn) {
				this.orders = [];
				this.cache.removeItem('/orders');
				this.consistencyState.ordersSent = false;
				if(this.isSimOnClient)
					this.cache.setItem('/sim', this.sim._serialize());
			}
			this.updateProduction(newTurn - this.turn);
			this.consistencyState.turn = this.turn = newTurn;
			return false;
		}
		case 'contact': {
			//console.log('event', evt);
			var tile = this.mapView.get(evt.x, evt.y);
			var contactUnit = tile.unit = this.units[evt.unit.id] = new Unit(evt.unit);
			if(tile.terrain===MD.OBJ && tile.party != contactUnit.party.id) {
				tile.party = contactUnit.party.id;
				if(!this.redrawMap)
					this.redrawMap = {x:evt.x, y:evt.y};
			}
			return false;
		}
		case 'contactLost': {
			//console.log('event', evt);
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

			let numParties = 0;
			for(let id in this.parties)
				++numParties;
			if(numParties>=this.numPartiesMax)
				this.hideMenuItem('joinCredentials');
		}
		console.log('presence event type:', evt.type, 'party:', evt.party);
	},
	handleInconsistencyEvent: function(evt) {
		if(evt.type=='getSituation') {
			this.turn = evt.turn;
			this.sim.getSituation(this.party, null, (data)=>{
				this.handleSituation(data); });
		}
		else if(evt.type=='postOrders')
			this.dispatchOrders(true);

		console.warn('inconsistency event type:', evt.type, 'turn:', evt.turn,
			'ordersReceived:', evt.ordersReceived);
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
			else if(this.cursor)
				this.cursor.visible = false;
			this.btnMain.setMode('fwd').setBackground(MD.Party[this.party].color);
			var msg = 'turn '+this.turn;

			if(this.turn==1) {
				msg += ' '+MD.Party[this.party].name;
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
				if(numParties+1 < this.numPartiesMax && !this.isDemo && !this.isTutorial)
					msg += ' &nbsp; join id: '+this.credentials.match;
				else
					this.hideMenuItem('joinCredentials');
			}
			this.displayStatus(msg);
			break;
		}

		case 'waiting':
			if(this.isDemo)
				this.btnMain.setMode('exit');
			else
				this.btnMain.setMode('spinner');
			this.displayStatus('turn '+this.turn+', waiting for events...');
			this.deselectUnit();
			break;

		case 'replay':
			if(this.cursor)
				this.cursor.visible = false;
			this.setInfo();
			if(this.isDemo)
				this.btnMain.setMode('exit');
			else
				this.btnMain.hide();
			console.log('replay events turn', this.turn);
			this.displayStatus('turn '+this.turn);
			this.nextSimEvent();
			break;

		case 'over': {
			this.selUnit = null;
			if(!this.isDemo && !this.isTutorial && localStorage) {
				delete localStorage.pelagium;
				this.cache.removeItem('/sim');
			}
			this.outcome = { screen:'over', party:this.credentials.party,
				winners:params.winners, loosers:params.loosers,
				capitulated:params.capitulated, stats:params.stats };

			this.btnMain.setMode('exit');
			this.hideMenuItem('joinCredentials').hideMenuItem('suspend').hideMenuItem('capitulate');
			let status = 'GAME OVER.';
			for(let i=0; i<params.winners.length; ++i)
				if(params.winners[i]==this.credentials.party) {
					status = 'VICTORY!';
					break;
				}
			this.displayStatus(status);
			break;
		}
		default:
			return console.error('unhandled application state', state);
		}
		this.state = this.consistencyState.state = state;
	},

	spawnAI: function(id, party, autoPilot=false) {
		let ai = new Worker('ai.js');
		this.workers.push(ai);
		let client = this;
		ai.onmessage = function(msg) {
			let evt = msg.data.type;
			let data = msg.data.data;
			if(evt=='credentials') {
				console.log('AI opponent has joined as '+MD.Party[data.party].name);
				if(client.isSimOnClient)
					client.sim._postPresenceEvent(data.party, 'join', data);
			}
			else if(evt=='error') {
				client.displayStatus('AI ERROR: '+data);
			}
			else if(msg.data.receiver === 'sim') { // delegate to single-player sim:
				let callback = msg.data.callback ? (data)=>{
					this.postMessage({callback:msg.data.callback, data:data});
				} : null;
				client.sim[msg.data.type](msg.data.sender, data, callback);
			}
			ai.emit(evt, data);
		}
		ai.on = function(event, callback) {
			if(!(event in this.eventListeners))
				this.eventListeners[event] = [];
			this.eventListeners[event].push(callback);
		}
		ai.emit = function(event, data) {
			[event, '*'].forEach((key)=>{
				if(key in this.eventListeners) {
					let callbacks = this.eventListeners[key];
					for(let i=0; i<callbacks.length; ++i)
						callbacks[i](event, data);
				}
			});
		}
		ai.eventListeners = {};

		let params;
		if(Array.isArray(id)) {
			let parties = id;
			let isResume = parties[0].id ? true : false;
			if(isResume)
				params = { cmd:'resume', id:[], party:[] };
			else
				params = { cmd:'join', id:this.credentials.match, party:[] };
			for(let i=0; i<parties.length; ++i) {
				params.party.push(parties[i].party);
				if(isResume)
					params.id.push(parties[i].id);
			}
		}
		else params = { cmd:id ? 'resume' : 'join', id:id?id:this.credentials.match, party:party, autoPilot:autoPilot };
		ai.postMessage(params);
		return ai;
	},

	hideMenuItem: function(dataId) {
		let item = document.querySelector('#main_menu > li[data-id="'+dataId+'"]');
		if(item)
			item.style.display = 'none';
		return this;
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
			popup.callback = null;
			return;
		}
		this.toggleMenu(false);
		popup.callback = callback;
		popup.firstElementChild.firstElementChild.innerHTML = msg;

		var ul = popup.firstElementChild.lastElementChild;
		ul.innerHTML = '';

		var items = [];
		for(var i=0; i<choices.length; ++i) {
			var item = document.createElement('li');
			item.appendChild(document.createTextNode(choices[i]));
			item.dataset.id = i;
			item.onclick = (evt)=>{ this.modalPopupTrigger(evt.target.dataset.id) };
			ul.appendChild(item);
			items.push(item);
		}
		eludi.click2touch(items);
		popup.style.display = '';
	},
	modalPopupVisible: function() {
		return document.getElementById('popup').style.display==='';
	},
	modalPopupChoices: function() {
		let popup = document.getElementById('popup');
		if(popup.style.display!=='')
			return null;
		return popup.firstElementChild.lastElementChild.children;
	},
	modalPopupTrigger: function(id) {
		let popup = document.getElementById('popup');
		if(popup.style.display!=='')
			return;
		popup.style.display = 'none';
		if(popup.callback) {
			popup.callback(id);
			popup.callback = null;
		}
	},

	checkSimOnClient: function() {
		if(!('isSimOnClient' in this)) {
			let params = eludi.paramsRequest(true);
			switch(params.cmd) {
			case 'demo':
			case 'tutorial':
				this.isSimOnClient = true;
				break;
			case 'resume':
			case 'start':
				this.isSimOnClient = true;
				if('parties' in params) for(let id in params.parties) {
					let partyType = params.parties[id];
					if(partyType==2) {
						this.isSimOnClient = false;
						break;
					}
				}
				break;
			default:
				console.warn('checkSimOnClient unhandled cmd:', params);
				this.isSimOnClient = false;
			}
		}
		console.log('sim runs on', this.isSimOnClient ? 'client' : 'server');
		return this.isSimOnClient;
	},
	initDebug: function() {
		if(this.dbgChannel)
			return false;

		let dbg = this.dbgChannel = new BroadcastChannel('pelagium_dbg');
		dbg.onmessage = (evt)=>{
			const msg = evt.data;
			if(typeof msg !== 'object' || ('receiver' in msg && msg.receiver!=='client'))
				return;
			console.log('debug msg', msg);

			if(msg.cmd == 'getSituation')
				this.sim.getSituation(this.party, null, (data)=>{ this.handleSituation(data); });
		}

		this.sim._initDebug();
		window.open('debug.html', 'pelagium debugger');

		return true;
	}

}

window.addEventListener("load", ()=>{
	let params = eludi.paramsRequest();
	let sim = new (window.SimProxy ? window.SimProxy : window.Sim)(params, (credentials, sim)=>{
		if(credentials && sim)
			client.init(credentials, sim);
		else
			client.close();
	});
	sim.on('error', (evt, msg)=>{
		client.modalPopup(msg, ['OK'], function(id) { client.close(); });
	});
	sim.on('warn', (evt, msg)=>{ client.displayStatus(msg); });

	if('ontouchstart' in window) // suppress zoom, scrolling
		for (let i = 0, all=document.querySelectorAll('.noselect'); i < all.length; ++i)
			all[i].addEventListener("touchmove", (evt)=>{ evt.preventDefault() });
});
let fadeIn = new TransitionFade('black',1.0,0.0);
setTimeout(()=>{ delete fadeIn; }, 600);

if(!client.checkSimOnClient())
	eludi.loadjs("sim_proxy.js");
else
	eludi.loadjs("sim.js", ()=>{ eludi.loadjs("builtinScenarios.js"); });
