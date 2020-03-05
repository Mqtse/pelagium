function extendCanvasContext(dc) {
	dc.circle = function(x,y,r, style) {
		if(style!==undefined) {
			this.save();
			for(var key in style)
				if(key==='lineDash')
					this.setLineDash(style[key]);
				else
					this[key] = style[key];
		}
		this.beginPath();
		this.arc(x,y, r, 0, 2*Math.PI, true);
		this.closePath();
		if(style.fillStyle)
			this.fill();
		if(style.strokeStyle)
			this.stroke();
		if(style!==undefined)
			this.restore();
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
	dc.dashLine = function(x1, y1, x2, y2, da = [10,5]) {
		this.save();
		this.setLineDash(da);
		this.strokeLine(x1,y1, x2,y2);
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
	dc.strokeUnit = function(type, w,h, lineWidth, color) {
		this.strokeStyle = color;
		this.lineWidth = lineWidth;
		switch(type) {
		case 'inf':
			this.strokeLine(0,0, w,h);
			this.strokeLine(0,h, w,0);
			break;
		case 'kv':
			this.strokeLine(0,h, w,0);
			break;
		case 'art':
			this.circle(w/2,h/2, 1.25*lineWidth, {fillStyle:color});
			break;
		case 'sail':
			this.beginPath();
			this.moveTo(w*0.5,h*0.3);
			this.arc(w*0.5,h*0.2, w*0.1, 0.5*Math.PI, 2.5*Math.PI, false);
			this.lineTo(w*0.5,h*0.8);
			this.moveTo(w*0.2, h*0.35);
			this.lineTo(w*0.8,h*0.35);
			this.stroke();
			this.beginPath();
			this.arc(w*0.5,h*0.45, w*0.4, 0.15*Math.PI, 0.85*Math.PI, false);
			this.stroke();
			break;
		}
	}

	return dc;
}

//--- animations ---------------------------------------------------
function AnimationSelected(tStart, unit, callback) {
	this.transform = function(tNow, transf) {
		var tFrac = tNow - this.tStart - 0.5;
		tFrac -= Math.floor(tFrac);
		transf.scx = transf.scy = 1.0 + Math.abs(tFrac - 0.5) * 0.5;
	}
	this.unit = unit;
	this.tStart = tStart;
	this.type = 'selected';
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
				deltaT = 0;
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
	this.type = 'move';
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
		transf.scx = transf.scy = 1.0 + deltaT*vel;
		transf.opacity = 1.0 - deltaT*vel;
	}
	this.unit = unit;
	this.tStart = tStart;
	this.type = 'explode';
}

function AnimationSupport(tStart, unit, destination, callback, cbData) {
	var vel = 2.0;
	this.transform = function(tNow, transf) {
		var deltaT = tNow - this.tStart;
		if(deltaT*vel >= this.distance) {
			this.unit.animation = null;
			if(callback)
				callback(this.unit, cbData);
			return;
		}
		if(deltaT > 0.5*this.distance/vel)
			deltaT = 0.5*this.distance/vel - deltaT;
		transf.x = this.dx * deltaT * vel;
		transf.y = this.dy * deltaT * vel;
	}
	this.unit = unit;
	var dest = destination;
	this.distance = 0.7;
	var angle = MatrixHex.angleRad(unit, dest);
	this.dx = Math.sin(angle);
	this.dy = -Math.cos(angle);
	this.tStart = tStart;
	this.type = 'support';
}


function TransitionFade(background='black', alphaFrom=0.0, alphaTo=1.0, duration=0.4) {
	let ovl = document.createElement('div');
	ovl.style.position = 'fixed';
	ovl.style.width='100vw';
	ovl.style.height='100vh';
	ovl.style.top = ovl.style.left = 0;
	ovl.style.background = background;
	ovl.style.opacity = alphaFrom;
	ovl.style.zIndex = 99999;
	document.documentElement.appendChild(ovl);

	let tStart = Date.now()/1000;
	let update = function() {
		let tNow = Date.now()/1000;
		if(tNow>=tStart+duration) {
			if(alphaTo<=0.0)
				document.documentElement.removeChild(ovl)
			return;
		}
		let pos = (tNow-tStart)/duration;
		ovl.style.opacity = (1.0-pos)*alphaFrom + pos*alphaTo;
		requestAnimationFrame(()=>{ update(); });
	}
	requestAnimationFrame(()=>{ update(); });
}

//--- renderer -----------------------------------------------------
function RendererAdhoc(dc, size, pixelRatio) {
	this.drawUnit = function(party, type, x,y, w,h, symbolOpacity=1.0) {
		const lineWidth = w/6;
		const shadowR = lineWidth*0.7*pixelRatio;
		dc.save();
		dc.shadowColor='rgba(0,0,0,0.4)';
		dc.shadowOffsetX = shadowR;
		dc.shadowOffsetY = shadowR;
		dc.shadowBlur = shadowR;
		dc.fillStyle = MD.Party[party].color;
		dc.fillRect(x,y, w, h);
		dc.restore();

		dc.save();
		dc.translate(x,y);
		dc.beginPath();
		dc.rect(0,0, w,h);
		dc.clip();
		dc.strokeUnit(type, w,h, lineWidth, 'rgba(255,255,255,'+symbolOpacity+')');
		dc.restore();
	}
}

function RendererSVG(dc, size, pixelRatio) {
	let silhouettes = {};
	let symbols = {};
	for(let type in MD.Unit) {
		const unitType = MD.Unit[type];
		if(!unitType.symbol) {
			let sprite = new Image();
			sprite.src = type+'.svg';
			silhouettes[type] = sprite;
		}
		else {
			const symbData = unitType.symbol;
			let symbol = symbols[type] = { coloredPaths:new Path2D(), monoPaths:new Path2D() };
			let m = document.createElementNS('http://www.w3.org/2000/svg', 'svg').createSVGMatrix();
			m.a = 1/symbData.width; m.b = 0;
			m.c = 0; m.d = 1/symbData.width;
			m.e = -0.2; m.f = -0.3;

			for(let key in symbol)
				for(let i=0; i<symbData[key].length; ++i)
					symbol[key].addPath(new Path2D(symbData[key][i]), m);
		}
	}

	this.drawUnit = function(party, type, x,y,w,h, symbolOpacity=1.0) {
		const lineWidth = w/6;
		const shadowR = lineWidth*0.7*pixelRatio;

		if(type in silhouettes) {
			dc.save();
			dc.shadowColor='rgba(0,0,0,0.4)';
			dc.shadowOffsetX = shadowR;
			dc.shadowOffsetY = shadowR;
			dc.shadowBlur = shadowR;
			dc.fillStyle = MD.Party[party].color;
			dc.fillRect(x,y,w,h);
			dc.restore();

			dc.save();
			dc.globalAlpha *= symbolOpacity;
			dc.drawImage(silhouettes[type], x,y,w,h);
			dc.restore();
		}
		else if(type in symbols) {
			dc.save();
			dc.shadowColor='rgba(0,0,0,0.4)';
			dc.shadowOffsetX = shadowR;
			dc.shadowOffsetY = shadowR;
			dc.shadowBlur = shadowR;

			let symbol = symbols[type];
			dc.translate(x,y);
			dc.scale(w*1.75, h*1.75);
			dc.fillStyle = MD.Party[party].color;
			dc.fill(symbol.coloredPaths);
			dc.globalAlpha *= symbolOpacity;
			dc.fillStyle='#fff';
			dc.fill(symbol.monoPaths);
			dc.restore();
		}
	}
}

//--- terrain shader -----------------------------------------------

var terrainShader = {
	forest: function(dc, x,y,radius,seed) {
		if(radius<20)
			return;
		var rnd = new Math.seedrandom(seed);
		const rx = radius*0.75, ry = Math.sin(Math.PI/3)*radius;
		const rMin = 1.5, rMax=5;
		const delta = 2*rMax, cRange=delta-2*rMin;
		dc.strokeStyle = 'rgba(115,170,130,0.7)';
		for(let cy=y-ry; cy<y+ry; cy+=delta)
			for(let cx=x-rx; cx<x+rx; cx+=delta) {
				let treeX = cx+rMin+rnd()*cRange, treeY =cy+rMin*rnd()*cRange;
				if(treeY>=y+ry || treeX>=x+rx)
					continue;
				dc.strokeCircle(treeX, treeY,rMin+rnd()*(rMax-rMin));
			}
		//dc.strokeStyle = 'rgb(127,127,127)';
		//dc.strokeRect(x-rx,y-ry, 2*rx,2*ry);
	},
	water_disabled: function(dc, x,y,radius,seed) {
		var rnd = new Math.seedrandom(seed);
		const rx = radius*0.7, ry = Math.sin(Math.PI/3)*radius;
		dc.save();
		dc.strokeStyle = 'rgba(255,255,255,0.5)';
		dc.lineWidth = 1.5;
		for(let i=0, end=Math.round(radius*radius/250); i<end; ++i) {
			let waveX = cx-rx+rnd()*2*rx, waveY =cy-ry+rnd()*2*ry, l=rnd()*4;
			dc.strokeLine(waveX, waveY,waveX+l,waveY);
		}
		dc.restore();
	},
	settlement: function(dc, x,y,radius,seed) {
		if(radius<20)
			return;
		var rnd = new Math.seedrandom(seed);
		const rx = radius*0.8, ry = Math.sin(Math.PI/3)*radius*0.8;
		const rMin = 1, rMax=2.5;
		const delta = 2*rMax, cRange=delta-2*rMin;
		const distMaxSqr = Math.pow(radius*0.7,2);
		dc.fillStyle = '#cea898';
		for(let cy=y-ry; cy<y+ry; cy+=delta)
			for(let cx=x-rx; cx<x+rx; cx+=delta) {
				let posX = cx+rMin+rnd()*cRange, posY =cy+rMin*rnd()*cRange;
				let w = rMin+rnd()*(rMax-rMin), h = rMin+rnd()*(rMax-rMin);
				if(Math.pow(posY-y,2)+Math.pow(posX-x,2)>distMaxSqr)
					continue;
				dc.fillRect(posX-w, posY-h,2*w,2*h);
			}
	},
	update_disabled: function(mapView) {
		if(Math.floor(Date.now()%25)!=0)
			return false;
		for(var x=0; x<mapView.width; ++x) {
			for(var y=0; y<mapView.height; ++y) {
				var tile = mapView.get(x,y);
				var terrain = tile.terrain;
				if(terrain == WATER && tile.color!==null && Math.random()>0.9)
					tile.color = (new Color(MD.Terrain[terrain].color)).variegate(3).rgbString();
			}
		}
		return true;
	}
};
