function PathFinder(map) {
	/// calculates direct path between two hexagons
	this.directPath = function(start, dest) {
		let x1=start.x+0.5, y1=start.y+0.5 + (map.hasOffsetY(start.x) ? 0.5 : 0.0);
		let x2=dest.x+0.5, y2=dest.y+0.5 + (map.hasOffsetY(dest.x) ? 0.5 : 0.0);
		let targetAngle = Math.atan2(x2-x1,y1-y2);
		let path = [ ];
		let curr = { x:start.x, y:start.y };
		let dst = { x:dest.x, y:dest.y };
		let currSqrDist = map.distCartSqr(curr, dst);

		while((curr.x!=dst.x)||(curr.y!=dst.y)) {
			path.push( {x:curr.x, y:curr.y, cost:path.length*2} );
			let minSqrDist = currSqrDist;
			let currMin = curr;
			let currAngle = 1000;
			for(let i=0; i<6; ++i) {
				let hex = map.polar2hex(curr, i);
				if(!hex)
					continue;
				let sqrDist =  map.distCartSqr(hex, dst);
				if(!sqrDist) {
					currMin = dst;
					break;
				}
				if(sqrDist<currSqrDist) {
					let hexX=hex.x+0.5, hexY=hex.y+0.5 + (map.hasOffsetY(hex.x) ? 0.5 : 0.0);
					let hexAngle = Math.abs(Math.atan2(x2-hexX, hexY-y2)-targetAngle);
					if(hexAngle<currAngle) {
						minSqrDist = sqrDist;
						currAngle = hexAngle;
						currMin = hex;
					}
				}
			}
			currSqrDist = minSqrDist;
			curr = currMin;
		}
		dst.cost = path.length*2;
		path.push(dst);
		return path;
	}

	this.movementCost = function(pos, direction, unitMedium) {
		if(unitMedium==MD.AIR)
			return 2;
		let nbPos = map.polar2hex(pos, direction);
		let tile = map.get(pos.x, pos.y), nbTile = map.get(nbPos.x, nbPos.y);
		if(!tile || !nbTile)
			return 0;
		if(unitMedium==MD.WATER)
			return (tile.terrain==MD.WATER && nbTile.terrain==MD.WATER) ? 2 : 0;
		if(tile.terrain==MD.WATER || nbTile.terrain==MD.WATER)
			return 0;
		return MD.Terrain[tile.terrain].move + MD.Terrain[nbTile.terrain].move;
	}

	/// calculates fastest path between two hexagons considering movement costs
	this.fastestPath = function(start, dest, unitMedium) {
		if(!map.isInside(start) || !map.isInside(dest))
			return [];
		if((dest.x == start.x)&&(dest.y == start.y)) // path finding not necessary
			return [{x:dest.x, y:dest.y, cost:0}];
		if(unitMedium==MD.AIR)
			return MatrixHex.directPath(start, dest);

		let open = [ {x:start.x, y:start.y} ];
		let isOpen = new MatrixHex(map.width, map.height, false);
		isOpen.set(start.x,start.y, true);
		let isClosed = new MatrixHex(map.width, map.height, false);
		let nodes = new MatrixHex(map.width, map.height, null);
		nodes.set(start.x,start.y, {pred: null, cost:0, estimatedTotal:0}); // start node

		while(true) {
			if(!open.length)
				return [];
			let indexBest = 0;
			let best = open[indexBest];
			let lowestEstimate = nodes.get(best.x,best.y).estimatedTotal;
			for(let i=1; i<open.length; ++i) {
				let hex = open[i];
				let estimatedTotal = nodes.get(hex.x,hex.y).estimatedTotal;
				if(estimatedTotal < lowestEstimate) {
					lowestEstimate = estimatedTotal;
					best = hex;
					indexBest = i;
				}
			}

			open.splice(indexBest, 1);
			isOpen.set(best.x,best.y, false);
			isClosed.set(best.x,best.y, true);
			if((best.x == dest.x)&&(best.y == dest.y)) 
				break; // destination found

			let bias = map.angleHex(best, dest);
			for(let dir=0; dir<6; ++dir) {
				let direction = (dir+bias)%6;
				let hex = map.polar2hex(best, direction);
				if(!hex||isClosed.get(hex.x,hex.y)) continue;
				let costStep = this.movementCost(best, direction, unitMedium);
				if(!costStep)
					continue;
				let cost = nodes.get(best.x,best.y).cost + costStep;

				if(!isOpen.get(hex.x,hex.y)) {
					isOpen.set(hex.x,hex.y, true);
					open.push({x:hex.x,y:hex.y});
					nodes.set(hex.x,hex.y, {pred: {x:best.x,y:best.y}, cost:cost,
						estimatedTotal:cost+map.distHex(hex, dest)} );
				}
				else {
					let node = nodes.get(hex.x,hex.y);
					if(node.cost > cost) {
						node.estimatedTotal += cost-node.cost;
						node.cost = cost;
						node.pred.x = best.x;
						node.pred.y = best.y;
					}
				}
			}
		}

		let node = nodes.get(dest.x,dest.y);
		let path = [ {x:dest.x, y:dest.y, cost:node.cost} ];
		let pred = node.pred;
		while(pred) {
			node = nodes.get(pred.x, pred.y);
			path.unshift(pred);
			path[0].cost = node.cost;
			pred = node.pred;
		}
		return path;
	}
	this.nearestDestination = function(pos, destinations, unitMedium) {
		let nearestDest = null;
		let minDist = Number.MAX_VALUE;
		for(let i=0; i<destinations.length; ++i) {
			let dest = destinations[i];
			let path = this.fastestPath(pos, dest, unitMedium);
			if(!path.length)
				continue;
			let cost = path[path.length-1].cost;
			if(cost<2*path.length-2) {
				console.error('implausible cost:', cost, ', path:', path);
				cost = 2*path.length-2;
			}
			if(cost < minDist) {
				minDist = cost;
				nearestDest = dest;
			}
		}
		return nearestDest;
	}
}