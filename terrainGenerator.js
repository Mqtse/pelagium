if(typeof require !== 'undefined') {
	Math.seedrandom = require('./static/seedrandom');
	MatrixHex = require('./static/shared').MatrixHex;
}

//------------------------------------------------------------------
function createTerrain(params) {
	var smoothen = function(map) {
		var smoothingSteps=4;
		var neighborCount = 3;
		var newMap = null;
		for(var step=0; step<smoothingSteps; ++step) {
			newMap = new MatrixHex(map.width, map.height, 0);

			for(var y=0; y<map.height; ++y) for(var x=0; x<map.width; ++x) {
				var value = map.get(x,y);
				if(value >= MD.OBJ) {
					newMap.set(x,y, value);
					continue;
				}

				var numNeighbors=0;
				var numForests=0;
				for(var i=0; i<6; ++i) {
					var nb = map.getPolar(x,y, i);
					if(nb)
						++numNeighbors;
					if(nb==MD.FOREST)
						++numForests;
				}

				if(numNeighbors>6-neighborCount) {
					var numPlains = numNeighbors-numForests;
					var terrain = (numPlains>numForests) ? MD.PLAIN :
						(numForests>numPlains) ? MD.FOREST :
						((x+y)%2) ? MD.PLAIN : MD.FOREST;
					newMap.set(x,y, terrain);
				}
				else if(numNeighbors>=neighborCount)
					newMap.set(x,y, map.get(x,y));
			}
			if(neighborCount>1)
				--neighborCount;
			map = newMap;
		}
		return newMap;
	}
	function filterMinorObjectives(page) {
		var objectives = page.objectives;
		// create a matrix giving each inhabited island an individual id and determine maxIslandId:
		var islands = new MatrixHex(page.width, page.height, 0);
		var islandObjCount = [ ];
		var islandObjCountMax = 0, maxIslandId=0;
		var numIslands = 0;
		for(var j=0; j<objectives.length; ++j) {
			var obj = objectives[j];
			var islandId =islands.get(obj.x,obj.y);
			if(!islandId) {
				islandId = ++numIslands;
				page.getRegion(islands, obj, islandId, function(value) { return value>MD.WATER; });
			}
			if(!islandObjCount[islandId])
				islandObjCount[islandId]=1;
			else
				++islandObjCount[islandId];
			if(islandObjCount[islandId]>islandObjCountMax) {
				islandObjCountMax = islandObjCount[islandId];
				maxIslandId=islandId;
			}
		}
		// filter out objectives on minor islands:
		for(var j=objectives.length; j--;) {
			var obj = objectives[j];
			if(islands.get(obj.x,obj.y) == maxIslandId)
				continue;
			objectives.splice(j,1);
			page.set(obj.x, obj.y, MD.PLAIN);
		}
	}

	var progs = {
		islandInhabited: function(seed, pageSz) {
			var rnd = new Math.seedrandom(seed);
			var page = new MatrixHex(pageSz, pageSz, MD.WATER);

			var center = (page.width-1)/2;
			var landProportionRim = 0.35;
			var landProportionCenter = 0.65;
			var border = 2;
			var distRimSqr = Math.pow(page.width/4, 2);

			// distribute objectives first:
			var distObjectives = 6;
			var width = page.width, height = page.height;

			var objectives = [ ];
			var nCols = Math.floor((width-4*border)/distObjectives);
			var nRows = Math.floor((height-4*border)/distObjectives);
			var distX = (width-4*border)/nCols;
			var distY = (height-4*border)/nRows;
			for(var i=0; i<nCols; ++i) for(var j=0; j<nRows; ++j) {
				var offsetX, offsetY;
				if((i==0&&j==0)||(i+1==nCols&&j+1==nRows)) { // corner
					offsetX = Math.floor((distObjectives-2)/2);
					offsetY = Math.floor((distObjectives-2)/2);
				}
				else {
					offsetX = rnd()*(distObjectives-2);
					offsetY = rnd()*(distObjectives-2);
				}
				var x=Math.round(2*border + i*distX + offsetX);
				var y=Math.round(2*border+ j*distY + offsetY);
				var obj = {x:x, y:y};
				objectives.push(obj);
				page.set(x,y, MD.OBJ);
				var start = Math.floor(rnd()*3);
				for(var dir=0; dir<3; ++dir) {
					var neighbor = page.polar2hex(obj, (dir+start)%6);
					page.set(neighbor.x,neighbor.y, MD.PLAIN);
				}
			}

			// create land:
			for(var x=border; x+border<page.width; ++x) for(var y=border; y+border<page.height; ++y) {
				if(page.get(x,y))
					continue;
				var distCenterSqr = Math.pow(center-x, 2)+Math.pow(center-y, 2);
				var landProportion = (distCenterSqr<distRimSqr) ? landProportionCenter : landProportionRim;
				if(rnd()<landProportion)
					page.set(x,y, (rnd()<0.5) ? MD.PLAIN : MD.FOREST);
			}
			page = smoothen(page);
			page.objectives = objectives;
			return page;
		}
	}

	var seed = params.seed || "pelagium";
	var pageSz = params.pageSz || 32;
	var progName = params.generator ? params.generator : "islandInhabited";

	if(!(progName in progs))
		return null;
	var terrain = progs[progName](seed, pageSz);
	if(terrain.objectives)
		filterMinorObjectives(terrain);

	if(params.tiles) for(var i = params.tiles.length; i--; ) {
		var tile = params.tiles[i];
		terrain.set(tile.x, tile.y, tile.terrain);
		if(tile.terrain == MD.OBJ && terrain.objectives) {
			var obj = terrain.objectives[tile.id];
			obj.x = tile.x;
			obj.y = tile.y;
		}
	}
	return terrain;
}

if(typeof module == 'object' && module.exports)
	module.exports = createTerrain;
