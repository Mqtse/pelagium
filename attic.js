function MapHex() {
	this.getRegion = function(x,y, cmpFunc) {
		var page = this.page;
		if(!cmpFunc) {
			var refValue = this.get(x,y).terrain;
			cmpFunc = function(other) { return other.terrain==refValue; }
		}

		var pos = {x:x,y:y};
		var open=[{x:pos.x%this.pageSz,y:pos.y%this.pageSz}], visited=[], result=[];
		while(open.length) {
			var node = open.pop();
			if(visited[node.x+page.width*node.y])
				continue;
			visited[node.x+page.width*node.y]=true;
			var value = page.get(node.x,node.y);
			if(!cmpFunc(value))
				continue;
			result.push(node);
			for(var i=0; i<6; ++i) {
				var nb = page.polar2hex(node, i);
				if(page.isInside(nb))
					open.push(nb);
			}
		}
		// transform page coordinates to global coordinates:
		var pageX = Math.floor(pos.x/this.pageSz), pageY = Math.floor(pos.y/this.pageSz);
		if(pageX || pageY) {
			var offsetX = pageX*this.pageSz, offsetY = pageY*this.pageSz;
			for(var i = result.length; i--; ) {
				var node = result[i];
				node.x += offsetX;
				node.y += offsetY;
			}
		}
		return result;
	}
}
