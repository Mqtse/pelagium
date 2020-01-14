if(typeof require !== 'undefined') {
	Color = require('./color');
	MD = require('./masterdata');
	createTerrain = require('../terrainGenerator');
}
else createTerrain = null;

//------------------------------------------------------------------
/// hexagonal matrix class
function MatrixHex(width, height, value) {
	MatrixHex.hasOffsetY = this.hasOffsetY = function(x) {
		return x%2==1;
	}
	MatrixHex.polar2hex = this.polar2hex = function(hex, dir, dist) { // dir 0=north, 1=northeast, 2=southeast,...
		dist=(dist===undefined)? 1 : Math.floor(dist);

		var offsetY = this.hasOffsetY(hex.x);
		var distodd = ((dist%2)!=0);
		var x = null, y=null;
		switch(dir) {
		case 0: // north
			x=hex.x; y=hex.y-dist; break;
		case 1: // north-east
			x=hex.x+dist; y=hex.y-Math.floor(dist/2)-((!distodd)?0:offsetY?0:1); break;
		case 2: // south-east
			x=hex.x+dist; y=hex.y+Math.floor(dist/2)+((!distodd)?0:offsetY?1:0); break;
		case 3: // south
			x=hex.x; y=hex.y+dist; break;
		case 4: // south-west
			x=hex.x-dist; y=hex.y+Math.floor(dist/2)+((!distodd)?0:offsetY?1:0); break;
		case 5: // north-west
			x=hex.x-dist; y=hex.y-Math.floor(dist/2)-((!distodd)?0:offsetY?0:1); break;
		default:
			return null;
		}
		return {x:x, y:y};
	}
	MatrixHex.neighbor = this.neighbor = function(hex, n) {
		if(n<0 || n>=36 || !(typeof n=='number'))
			return null;
		if(n<6)
			return this.polar2hex(hex,n);
		if(n<18) {
			var dirBase = Math.floor((n-6)/2);
			var hexBase = this.polar2hex(hex, dirBase, 2);
			var remainder = Math.round(2*((n-6)/2 - dirBase));
			if(!remainder)
				return hexBase;
			return this.polar2hex(hexBase,(dirBase+2)%6, remainder);
		}
		var dirBase = Math.floor((n-18)/3);
		var hexBase = this.polar2hex(hex, dirBase, 3);
		var remainder = Math.round(3*((n-18)/3 - dirBase));
		if(!remainder)
			return hexBase;
		return this.polar2hex(hexBase,(dirBase+2)%6, remainder);
	}
	/// distance in hexes
	MatrixHex.distHex = this.distHex = function(hex1, hex2) {
		var dx = hex2.x-hex1.x;
		var dy = hex2.y-hex1.y;
		if(!dx)
			return Math.abs(dy);

		var dir = (dx>0) ? ( (dy>0)?2:1 ) : ( (dy>0)?4:5 );
		var hexbase= this.polar2hex(hex1,dir,Math.abs(dx));
		if(!hexbase)
			return null;
		dy=hex2.y-hexbase.y;
		switch(dir) {
		case(1): return Math.abs(dx) + ((dy>0)?0:-dy);
		case(2): return Math.abs(dx) + ((dy>0)?dy:0);
		case(4): return Math.abs(dx) + ((dy>0)?dy:0);
		case(5): return Math.abs(dx) + ((dy>0)?0:-dy);
		}
	}
	/// cartesian squared distance
	MatrixHex.distCartSqr = this.distCartSqr = function(hex1, hex2) {
		var x1 = hex1.x+0.5, y1 = hex1.y + 0.5 + (this.hasOffsetY(hex1.x) ? 0.5 : 0.0);
		var x2 = hex2.x+0.5, y2 = hex2.y + 0.5 + (this.hasOffsetY(hex2.x) ? 0.5 : 0.0);
		if(typeof hex1.fracX!='undefined') {
			x1+=hex1.fracX-0.5;
			y1+=hex1.fracY-0.5;
		}
		if(typeof hex2.fracX!='undefined') {
			x2+=hex2.fracX-0.5;
			y2+=hex2.fracY-0.5;
		}
		return Math.pow(x2-x1, 2) + Math.pow(y2-y1, 2);
	}
	/// cartesian distance
	MatrixHex.distCart = this.distCart = function(hex1, hex2) {
		return Math.sqrt(this.distCartSqr(hex1, hex2));
	}
	/// returns angle between two hexes in radians (0=north, PI/2=east,...)
	MatrixHex.angleRad = this.angleRad = function(hex1, hex2) {
		var x1=hex1.x+0.5, y1=hex1.y+0.5 + (this.hasOffsetY(hex1.x) ? 0.5 : 0.0);
		var x2=hex2.x+0.5, y2=hex2.y+0.5 + (this.hasOffsetY(hex2.x) ? 0.5 : 0.0);
		var rad = Math.atan2(x2-x1,y1-y2);
		return (rad<0.0) ? rad+2.0*Math.PI : rad;
	}
	/// returns angle between two hexes in integral hex steps (0=north, 1=northeast, 2=southeast,...)
	MatrixHex.angleHex = this.angleHex = function(hex1, hex2) {
		return Math.round(3*this.angleRad(hex1,hex2)/Math.PI);
	}

	this.reset = function(value) {
		this.data = [];
		if(typeof value == 'object') { // deepcopy needed
			for(var y = 0; y<this.height;++y) for(var x = 0; x<this.width; ++x)
				this.data.push(JSON.parse( JSON.stringify( value ) ));
		}
		else {
			for(var y = 0; y<this.height;++y) for(var x = 0; x<this.width; ++x)
				this.data.push(value);
		}
	}
	/// returns value at hexagonal coordinate (x|y)
	this.get = function(x, y) {
		//if(x<0 || x>=this.width || y<0 || y>=this.height ) return null;
		return this.data[y*this.width+x];
	}
	this.set = function(x,y, value) {
		//if(x<0 || x>=this.width || y<0 || y>=this.height ) return null;
		this.data[y*this.width+x] = value;
	}
	this.isInside = function(pos) {
		return ((pos.x<0)||(pos.y<0)||(pos.x>=this.width)||(pos.y>=this.height)) ? false : true;
	}
	this.getPolar = function(x, y, dir, dist) {
		var c={x:x, y:y};
		var pos = this.polar2hex(c, dir, dist);
		return this.isInside(pos) ? this.get(pos.x, pos.y) : null;
	}
	this.getNeighbor = function(pos, dir) {
		var nb = this.polar2hex(pos, dir);
		return this.isInside(nb) ? this.get(nb.x, nb.y) : null;
	}
	this.getRegion = function(resultMatrix, pos, regionId, cmpFunc) {
		var open=[{x:pos.x,y:pos.y}], visited=[];
		while(open.length) {
			var node = open.pop();
			if(visited[node.x+this.width*node.y])
				continue;
			visited[node.x+this.width*node.y]=true;
			var value = this.get(node.x,node.y);
			if(!cmpFunc(value))
				continue;
			resultMatrix.set(node.x, node.y, regionId);
			for(var i=0; i<6; ++i) {
				var nb = this.polar2hex(node, i);
				if(this.isInside(nb))
					open.push(nb);
			}
		}
	}

	this.serialize = function(rleEncode) {
		var values = rleEncode ? MatrixHex.rleEncode(this.data) : this.data;
		var data = { width:this.width, height:this.height, data:values };
		return data;
	}
	this.deserialize = function(data) {
		this.width = data.width;
		this.height = data.height;
		if(data.data.length==this.width*this.height)
			this.data = data.data;
		else {
			this.data = MatrixHex.rleDecode(data.data);
			if(this.data.length!=this.width*this.height)
				throw 'rle decoding failed.';
		}
	}

	if(height===undefined)
		return this.deserialize(width);
	this.width = width;
	this.height = height;
	this.reset(value);
}

MatrixHex.rleEncode = function(data) {
	var lastValue = undefined;
	var out = [];
	for(var i=0, end=data.length; i!=end; ++i) {
		var value = data[i];
		if(value !== lastValue) {
			out.push(value);
			lastValue = value;
		}
		else if(out[out.length-1]>=0)
			out.push(-1); // start RLE encoding
		else
			--out[out.length-1]; // increment RLE encoding
	}
	return out;
}
MatrixHex.rleDecode = function(data) {
	var lastValue = undefined;
	var out = [];
	for(var i=0, end=data.length; i!=end; ++i) {
		var value = data[i];
		if(value>=0) {
			out.push(value);
			lastValue = value;
		}
		else for(var j=0, jend = -value; j!=jend; ++j)
			out.push(lastValue);
	}
	return out;
}


//------------------------------------------------------------------
function MatrixSparse(defaultValue) {
	this.get = function(x,y) { var key = x+'_'+y; return (key in this.data) ? this.data[key] : defaultValue; }
	this.set = function(x,y, value) { this.data[x+'_'+y] = value; }
	this.incr = function(x,y, delta) { this.data[x+'_'+y] = this.get(x,y)+delta; }
	this.isInside = function(pos) { return true; }
	this.data = {};
}


//------------------------------------------------------------------
function MapHex(params) {

	this.getFieldOfView = function(party) {
		var units = [ ];
		var rangeMax=2, sz = this.pageSz;
		for(var x=-rangeMax; x<sz+rangeMax; ++x) for(var y=-rangeMax; y<sz+rangeMax; ++y) {
			var tile = this.get(x, y);
			if(tile.unit && tile.unit.party.id==party)
				units.push(tile.unit);
			else if(tile.party==party) // dummy unit making own objectives transparent
				units.push(new Unit({x:x, y:y, party:party}));
		}

		var fov = new MatrixHex(sz, sz, 0);
		for(var i=units.length; i--;)
			units[i].getFieldOfView(this, fov);
		return fov;
	}
	this.getTerrain = function(page, compress) {
		if(page!=0)
			return null;
		var view = { page:0, width:this.pageSz, height:this.pageSz, data:[] };
		for(var i=0, end=this.page.data.length; i!=end; ++i)
			view.data.push(this.page.data[i].terrain);
		if(compress)
			view.data = MatrixHex.rleEncode(view.data);
		return view;
	}
	this.getObjectives = function(page=0) {
		if(page!=0)
			return [];
		var objectives = [];
		for(var x=0; x!=this.pageSz; ++x)
			for(var y=0; y!=this.pageSz; ++y)
				if(this.page.get(x, y).terrain == MD.OBJ)
					objectives.push({ id:objectives.length, x:x, y:y });
		return objectives;
	}

	this.get = function(x,y) {
		if(x<0 || y<0 || x>=this.pageSz || y>=this.pageSz)
			return { terrain:MD.WATER, color:null };
		return this.page.get(x, y);
	}
	this.getPolar = function(x, y, dir, dist) {
		return this.page.getPolar(x, y, dir, dist);
	}

	this.unifyMap = function(terrain, objectives, starts) {
		var page = new MatrixHex(terrain.width, terrain.height, { terrain:0 });
		for(var x=0; x<page.width; ++x) for(var y=0; y<page.height; ++y) {
			var tile = page.get(x,y);
			tile.terrain = terrain.get(x,y);
		}

		if(objectives) {
			if(starts) for(var party in starts) {
				var objId = starts[party];
				if(objId<objectives.length)
					objectives[objId].party = party;
			}

			for(var i=objectives.length; i--; ) {
				var obj = objectives[i];
				var tile = page.get(obj.x, obj.y);
				tile.id = ('id' in obj) ? obj.id : i;
				if(obj.party) {
					tile.party = obj.party;
					tile.production = obj.production || 'inf';
					tile.progress = obj.progress || 0;
				}
			}
		}
		return page;
	}

	this.unitAdd = function(unit) {
		var tile = this.page.get(unit.x, unit.y);
		if(!tile || tile.unit)
			return null;
		tile.unit = new Unit(unit);
		return tile.unit;
	}
	this.unitMove = function(unit, dest, events) {
		var tile = this.page.get(dest.x, dest.y);
		if(!tile || !MD.isNavigable(tile.terrain, unit.type) || this.page.distHex(unit, dest)!=1)
			return false;

		var blockEvent = unit.isBlocked(this.page, dest, tile);
		if(blockEvent) {
			events.push(blockEvent);
			return false;
		}

		var start = this.page.get(unit.x, unit.y);
		if(start && start.unit == unit)
			start.unit = null;
		unit.x = dest.x;
		unit.y = dest.y;
		return true;
	}
	this.unitsInit = function(params) {
		if(params.units)
			params.units.forEach(function(unit) { this.unitAdd(unit); }, this);
		else if(params.objectives && params.starts) {
			var objectives = params.objectives;
			var starts = params.starts;
			params.units = [];
		
			// determine minimum number of adjacent land tiles:
			var numUnitsMax = 6;
			for(var party in starts) {
				var objId = starts[party];
				if(objId>=objectives.length)
					continue;
				var obj = objectives[objId];
				var numAdjacentLandTiles = 0;
				for(var i=0; i<6; ++i)
					if(this.page.getPolar(obj.x, obj.y, i).terrain > MD.WATER)
						++numAdjacentLandTiles;
				numUnitsMax = Math.min(numUnitsMax, numAdjacentLandTiles);
			}
			// place units round robin:
			for(var party in starts) {
				var objId = starts[party];
				if(objId>=objectives.length)
					continue;
				var obj = objectives[objId];
				var numUnits = 0;
				for(var i=0; i<6 && numUnits<numUnitsMax; ++i) {
					var pos = this.page.polar2hex(obj, i);
					var tile = this.page.get(pos.x, pos.y);
					if(tile.terrain <= MD.WATER)
						continue;
					var unit = {type:null, party:party, x:pos.x, y:pos.y};
					switch(numUnits%3) {
					case 0: unit.type='inf'; break;
					case 1: unit.type='kv'; break;
					case 2: unit.type='art'; break;
					}
					this.unitAdd(unit);
					++numUnits;
					params.units.push(unit);
				}
			}
		}
	}

	this.serialize = function() {
		var data = {
			terrain: this.getTerrain(0, true),
			units:[],
			objectives:[]
		}
		for(var i=0, end = this.page.data.length; i<end; ++i) {
			var tile = this.page.data[i];
			if(tile.unit)
				data.units.push(tile.unit.serialize());
			if(tile.terrain == MD.OBJ)
				data.objectives.push({ id:tile.id, x:i%this.pageSz, y:Math.floor(i/this.pageSz) });
			if(tile.party) {
				var obj = data.objectives[data.objectives.length-1];
				obj.party = tile.party;
				obj.production = tile.production;
				obj.progress = tile.progress;
			}
		}
		return data;
	}

	this.deserialize = function(data) {
		var terrain = new MatrixHex(data.terrain);
		this.pageSz = terrain.width;
		this.page = this.unifyMap(terrain, data.objectives, data.starts);
	}

	this.createMap = function(params) {
		var terrain = createTerrain(params);
		this.pageSz = terrain.width;
		this.page = this.unifyMap(terrain, terrain.objectives, params.starts);
	}

	if(createTerrain && ('seed' in params))
		this.createMap(params);
	else
		this.deserialize(params);
	this.unitsInit(params);
}

MapHex.finalizeAppearance = function(page) {
	for(var i=0, end = page.data.length; i!=end; ++i)
		page.data[i] = { terrain:page.data[i] };
	for(var x=0; x<page.width; ++x) for(var y=0; y<page.height; ++y) {
		var tile = page.get(x,y);
		if(tile.terrain==MD.FOREST)
			tile.color = (new Color(MD.Terrain[tile.terrain].color)).variegate(7).rgbString();
		else if(tile.terrain==MD.PLAIN)
			tile.color = (new Color(MD.Terrain[tile.terrain].color)).variegate(4).rgbString();

		else if(tile.terrain==MD.WATER) {
			var pos = { x:x, y:y };
			var nb=null;
			for(var i=0; i<6 && !nb; ++i) {
				nb = page.getNeighbor(pos, i);
				if(nb && nb.terrain==MD.WATER)
					nb=null;
			}
			if(!nb)
				tile.color=null;
			else
				tile.color = (new Color(MD.Terrain[tile.terrain].color)).variegate(3).rgbString();
		}
	}
}

MapHex.calculateCellMetrics = function(height) {
	return {
		h:height,
		r: Math.tan(Math.PI/6)*height,
		w: 1.5 * Math.tan(Math.PI/6)*height
	};
}

MapHex.draw = function(canvas, map, vp, cellMetrics, fieldOfView, fastMode) {
	var fogOfWar = null;
	var fowScale=0.125;
	var fowRadius =(cellMetrics.r+cellMetrics.h/5)*fowScale;
	var fowMargin = .2;
	var drawWater = fastMode ? 1 : 0;
	var lineWidth = Math.max(cellMetrics.r/8, 1.5);

	var dc = canvas.getContext('2d');
	if(fieldOfView && !fastMode) { // fog of war
		fogOfWar = document.createElement('canvas');
		var width = fogOfWar.width = canvas.width*fowScale/vp.pixelRatio;
		var height = fogOfWar.height = canvas.height*fowScale/vp.pixelRatio;
		var ctx = fogOfWar.dc = extendCanvasContext(fogOfWar.getContext('2d'));
		ctx.fillStyle='rgba(0,0,0,0.2)';
		ctx.fillRect(0,0, width, height);
		ctx.fillStyle='white';
		ctx.globalCompositeOperation='destination-out';
	}

	for(var x=Math.max(0,vp.x), xEnd=Math.min(vp.x+vp.width, map.width); x<xEnd; ++x) {
		var offsetX = vp.offsetX ? vp.offsetX : 0;
		var offsetY = vp.offsetY ? vp.offsetY : 0;
		if(x%2)
			offsetY+=0.5*cellMetrics.h;
		for(var y=Math.max(0,vp.y), yEnd=Math.min(vp.y+vp.height, map.height); y<yEnd; ++y) {
			var tile = map.get(x,y);
			if(!tile)
				continue;
			var terrain = tile.terrain;
			var fill = ('color' in tile) ? tile.color : MD.Terrain[terrain].color;
			var cx = (x-vp.x)*cellMetrics.w+offsetX, cy = (y-vp.y)*cellMetrics.h+offsetY;
			if(terrain==MD.OBJ && tile.party && !fastMode) {
				var strokeStyle = MD.Party[tile.party].color;
				dc.hex(cx, cy, cellMetrics.r-fowMargin-lineWidth/2,
					{ fillStyle:fill, strokeStyle:strokeStyle, lineWidth:lineWidth });
			}
			else if(fill && (terrain>=drawWater))
				dc.hex(cx, cy, cellMetrics.r-fowMargin, { fillStyle:fill });
			if(fogOfWar && fieldOfView.get(x,y)!==0)
				fogOfWar.dc.hex(cx*fowScale, cy*fowScale, fowRadius, { fillStyle:'white' });
		}
	}

	if(!fastMode) { // terrain details:
		dc.lineWidth = 1.5;
		for(var x=Math.max(0,vp.x), xEnd=Math.min(vp.x+vp.width, map.width); x<xEnd; ++x) {
			var offsetX = vp.offsetX ? vp.offsetX : 0;
			var offsetY = vp.offsetY ? vp.offsetY : 0;
			if(x%2)
				offsetY+=0.5*cellMetrics.h;
			for(var y=Math.max(0,vp.y), yEnd=Math.min(vp.y+vp.height, map.height); y<yEnd; ++y) {
				var tile = map.get(x,y);
				var shader = terrainShader[MD.Terrain[tile.terrain].name];
				if(!shader)
					continue;
				var cx = (x-vp.x)*cellMetrics.w+offsetX, cy = (y-vp.y)*cellMetrics.h+offsetY;
				var seed = x + map.width*y;
				shader(dc, cx, cy, cellMetrics.r-fowMargin, seed);
			}
		}
	}

	if(fogOfWar)
		dc.drawImage(fogOfWar, 0,0, canvas.width/vp.pixelRatio, canvas.height/vp.pixelRatio);
}

//--- Unit ---------------------------------------------------------
function Unit(data) {
	this.serialize = function() {
		return { type:this.type.id, x:this.x, y:this.y, id:this.id, party:this.party.id };
	}

	this.isAccessible = function(tile) {
		 return tile && MD.isNavigable(tile.terrain, this.type);
	}
	this.isBlocked = function(map, dest, tile, unitsToIgnore) {
		if(tile.unit) {
			if(tile.unit.party.id!=this.party.id)
				return false; // direct attack always allowed
			if(!unitsToIgnore || !(tile.unit.id in unitsToIgnore))
				return { type:'blocked', unit:this.id, x:dest.x, y:dest.y, blocker:tile.unit.id };
		}
		// test whether movement is blocked by adjacent enemies:
		var moveVector = MatrixHex.angleHex(this, dest);
		var nb = map.getPolar(this.x, this.y, (moveVector+5)%6);
		if(nb.unit && nb.unit.party.id!=this.party.id && nb.unit.type.attack)
			return { type:'blocked', unit:this.id, x:dest.x, y:dest.y, blocker:nb.unit.id };

		nb = map.getPolar(this.x, this.y, (moveVector+1)%6);
		if(nb.unit && nb.unit.party.id!=this.party.id && nb.unit.type.attack)
			return { type:'blocked', unit:this.id, x:dest.x, y:dest.y, blocker:nb.unit.id };
		return false;
	}

	this.getFieldOfMovement = function(map, unitsToIgnore) {
		var radius = this.type.move;
		if(radius>3)
			throw 'movement radii>3 not implemented.';

		var nbh = new MatrixSparse(null);
		var center = { x:this.x, y:this.y, move:MD.Terrain[map.get(this.x, this.y).terrain].move,
			dist:0, pred:null};
		nbh.set(this.x, this.y, center);

		for(var i=0; i<6; ++i) {
			var nb = map.polar2hex(center, i, 1);
			var tile = map.get(nb.x, nb.y);
			if(!this.isAccessible(tile) || this.isBlocked(map, nb, tile, unitsToIgnore))
				continue;
			var move = MD.Terrain[tile.terrain].move;
			var newNbhTile = {x:nb.x, y:nb.y, move:move, dist:center.move+move, pred:center, unit:tile.unit};
			nbh.set(nb.x, nb.y, newNbhTile);
		}

		var nb2test = [];
		if(radius>1)
			nb2test = [7,9,11,13,15,17, 6,8,10,12,14,16];
		if(radius>2)
			for(var i=18; i<36;++i)
				nb2test.push(i);

		for(var i=0, end = nb2test.length; i!=end; ++i) {
			var nb = map.neighbor(this, nb2test[i]);
			var tile = map.get(nb.x, nb.y);
			if(!this.isAccessible(tile))
				continue;

			var newNbhTile = null;
			for(var dir=0; dir<6; ++dir) {
				var pos = map.polar2hex(nb, dir, 1);
				var nbhTile = nbh.get(pos.x, pos.y);
				if(nbhTile===null)
					continue;
				if(nbhTile.unit && (!unitsToIgnore || !(nbhTile.unit.id in unitsToIgnore)))
					continue;

				this.x = pos.x;
				this.y = pos.y;
				var isBlocked = this.isBlocked(map, nb, tile, unitsToIgnore);
				this.x = center.x;
				this.y = center.y;
				if(isBlocked)
					continue;

				var move = MD.Terrain[tile.terrain].move;
				var currDist = nbhTile.dist + nbhTile.move + move;
				if(!newNbhTile || currDist<newNbhTile.dist)
					newNbhTile = {x:nb.x, y:nb.y, move:move, dist:currDist, pred:nbhTile, unit:tile.unit};
			}
			if(newNbhTile!==null && newNbhTile.dist<=2*radius)
				nbh.set(nb.x, nb.y, newNbhTile);
		}
		var result = [];
		for(var key in nbh.data) {
			var tile = nbh.data[key];
			if(tile.x==this.x && tile.y==this.y)
				continue;
			result.push(tile);
		}
		return result.length ? result : null;
	}

	this.getFieldOfView = function(map, fov) {
		var range = this.type ? this.type.visualRange : 1;
		var pos = { x:this.x, y:this.y };
		if(fov.isInside(pos))
			fov.set(pos.x, pos.y, 1);
		if(range<1)
			return;
		for(var dir=6; dir--;) {
			pos = MatrixHex.polar2hex(this, dir);
			if(fov.isInside(pos))
				fov.set(pos.x, pos.y, 1);
		}
		if(range<2)
			return;
		// straight cases:
		for(var dir=6; dir--;) {
			pos = MatrixHex.polar2hex(this, dir, 2);
			if(!fov.isInside(pos))
				continue;
			var terrain = map.get(pos.x, pos.y).terrain;
			if(MD.Terrain[terrain].concealment)
				continue;
			var inBetween = MatrixHex.polar2hex(this, dir);
			terrain = map.get(inBetween.x, inBetween.y).terrain;
			if(MD.Terrain[terrain].concealment)
				continue;
			fov.set(pos.x, pos.y, 1);
		}
		// now the ugly cases: range >1 non-straight
		var remainingTiles = [
			{ pos:{x:this.x+2, y:this.y }, dirs:[1,2] },
			{ pos:{x:this.x-2, y:this.y }, dirs:[4,5] },
			{ pos:{x:this.x-1, y:(this.x%2==1)?this.y-1:this.y-2 }, dirs:[0,5] },
			{ pos:{x:this.x+1, y:(this.x%2==1)?this.y-1:this.y-2 }, dirs:[0,1] },
			{ pos:{x:this.x+1, y:(this.x%2==1)?this.y+2:this.y+1 }, dirs:[2,3] },
			{ pos:{x:this.x-1, y:(this.x%2==1)?this.y+2:this.y+1 }, dirs:[3,4] },
		]
		for(var j=remainingTiles.length; j--; ) {
			var tile = remainingTiles[j];
			pos = tile.pos;
			if(!fov.isInside(pos))
				continue;
			var terrain = map.get(pos.x, pos.y).terrain;
			if(MD.Terrain[terrain].concealment)
				continue;
			var inBetween = MatrixHex.polar2hex(this, tile.dirs[0]);
			terrain = map.get(inBetween.x, inBetween.y).terrain;
			if(!MD.Terrain[terrain].concealment)
				fov.set(pos.x, pos.y, 1);
			else if(tile.dirs.length>1) {
				inBetween = MatrixHex.polar2hex(this, tile.dirs[1]);
				terrain = map.get(inBetween.x, inBetween.y).terrain;
				if(!MD.Terrain[terrain].concealment)
					fov.set(pos.x, pos.y, 1);
			}
		}
	}

	this.getPath = function(map, destX, destY, unitsToIgnore) {
		var fom = this.getFieldOfMovement(map, unitsToIgnore);
		var step = null;
		for(var i=0, end=(fom===null) ? 0 : fom.length; i!=end && step===null; ++i)
			if(fom[i].x==destX && fom[i].y==destY)
				step=fom[i];
		if(!step)
			return [];

		var path = [];
		do {
			path.push({ x:step.x, y:step.y});
			step = step.pred;
		} while(step.x!=this.x || step.y!=this.y);
		return path.reverse();
	}

	this.getDefense = function(map) {
		var location = map.get(this.x, this.y);
		return this.type.defend * MD.Terrain[location.terrain].defend;
	}

	this.type = MD.Unit[data.type ? data.type : 'inf'];
	this.x = data.x;
	this.y = data.y;
	if(data.id) {
		this.id = data.id;
		Unit.serial = Math.max(Unit.serial, data.id);
	}
	else
		this.id = ++Unit.serial;
	this.party = MD.Party[data.party];
	this.animation = null;
	this.destination = null;
	this.state = 'alive';
}
Unit.serial = 0;

if(typeof module == 'object' && module.exports)
	module.exports = { MapHex:MapHex, MatrixHex:MatrixHex, MatrixSparse:MatrixSparse, Unit:Unit };
