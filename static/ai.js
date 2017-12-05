if(typeof importScripts === 'function') { // webworker
	importScripts(
		"/static/masterdata.js",
		"/static/infra.js",
		"/static/shared.js",
		"/static/pathfinder.js",
		"/static/sim_proxy.js");
}

let Attitude = {
	expansive: {
		name:'expansive',
		buildProbability: {
			inf:2,
			kv:3,
			art:0
		}
	}
}

let Mission = function(type, ai, map, x,y) {
	this.assignUnit = function(unit) {
		if(unit.mission && unit.mission in ai.missions) {
			let oldMission = ai.missions[unit.mission];
			delete oldMission.units[unit.id];
			--oldMission.numUnits;
		}
		this.units[unit.id] = unit;
		unit.mission = this.id;
		++this.numUnits;
		return true;
	}
	this.cleanup = function() {
		for(let id in this.units) {
			let unit = ai.units[id];
			if(unit && unit.mission==this.id) 
				delete unit.mission;
		}
		this.units = {};
		this.numUnits = 0;
		delete ai.missions[this.id];
	}
	this.verifyUnit = function(id) {
		let unit = ai.units[id];
		if(!unit && (id in this.units)) {
			delete this.units[id];
			--this.numUnits;
		}
		return unit;
	}
	this.str = function() { // for logging / debug
		let s = this.type+' x:'+this.x+' y:'+this.y+ ' units:[ ';
		for(let id in this.units)
			s += id+' ';
		return s+']'
	}

	this.type = type;
	this.x = x;
	this.y = y;
	this.id = Mission.makeid(this);
	this.units = {};
	this.numUnits = 0;
}
Mission.makeid = function(obj) {return obj.x+'_'+obj.y; }

let MissionExpand = function(ai, map, x,y) {
	this.generateOrders = function(orders) {
		for(let id in this.units) {
			let unit = this.verifyUnit(id);
			if(!unit)
				continue;
			let path = ai.pathFinder.fastestPath(unit, this, unit.type.medium);
			let cost = 0;
			let dest = null;
			for(let i = 1; i<path.length && !dest; ++i) {
				cost += MD.Terrain[map.get(path[i-1].x,path[i-1].y).terrain].move;
				cost += MD.Terrain[map.get(path[i].x,path[i].y).terrain].move;
				if(cost >=2*unit.type.move || i+1==path.length)
					dest = path[i];
			}
			let order = { type:'move', unit:id, from_x:unit.x, from_y:unit.y, to_x:dest.x, to_y:dest.y };
			console.log(this.type, order);
			orders.push(order);
		}
	}
	this.isOver = function() {
		let tile = map.get(this.x, this.y);
		if(tile.party == ai.credentials.party)
			return true;
		if(tile.unit && tile.unit.party.id==ai.credentials.party)
			return true;

		for(let id in this.units)
			if(this.verifyUnit(id))
				return false;
		return true;
	}
	Mission.call(this, 'expand', ai, map, x, y);
}
MissionExpand.prototype = Object.create(Mission.prototype);
MissionExpand.prototype.constructor = MissionExpand;

let MissionAttack = function(ai, map, x,y) {
	this.generateOrders = function(orders) {
		for(let id in this.units) {
			let unit = this.verifyUnit(id);
			if(!unit)
				continue;
			let order = { type:'move', unit:id,
				from_x:unit.x, from_y:unit.y, to_x:this.x, to_y:this.y };
			console.log(this.type, order);
			orders.push(order);
		}
	}
	this.isOver = function() {
		for(let id in this.units) {
			let unit = this.verifyUnit(id);
			if(unit && unit.x == this.x && unit.y == this.y)
				return true;
		}
		return this.numUnits <= 0;
	}
	Mission.call(this, 'attack', ai, map, x, y);
}
MissionAttack.prototype = Object.create(Mission.prototype);
MissionAttack.prototype.constructor = MissionAttack;


let MissionDefend = function(ai, map, x,y) {
	this.generateOrders = function(orders) {
		for(let id in this.units) {
			let unit = this.verifyUnit(id);
			if(!unit || (unit.x==this.x && unit.y==this.y))
				continue;
			// todo, check path length, reachability, etc.
			let order = { type:'move', unit:id,
				from_x:unit.x, from_y:unit.y, to_x:this.x, to_y:this.y };
			console.log(this.type, order);
			orders.push(order);
		}
	}
	this.isOver = function() {
		return MissionDefend.checkNeed(this,ai.map,ai.credentials.party)==false;
	}
	Mission.call(this, 'defend', ai, map, x, y);
}
MissionDefend.prototype = Object.create(Mission.prototype);
MissionDefend.prototype.constructor = MissionDefend;

MissionDefend.checkNeed = function(obj, map, party) {
	if(obj.party != party)
		return false;

	let defenders = [];
	let unit = map.get(obj.x,obj.y).unit;
	if(unit && unit.party.id==party)
		defenders.push(unit);
	let attackers = [];
	for(let j=0; j<36; ++j) {
		let pos = map.neighbor(obj, j);
		let tile = map.get(pos.x, pos.y);
		if(!tile || !tile.unit)
			continue;
		if(tile.unit.party.id!=party)
			attackers.push(tile.unit);
		else
			defenders.push(tile.unit);
	}
	if(attackers.length===0 || defenders.length===0)
		return false;
	return defenders.slice(0, Math.ceil(attackers.length*1.33));
}

let AI = function(sim, credentials) {
	this.handleTerrain = function(data) {
		console.log('terrain received');

		this.map = new MatrixHex(data);
		this.objectives = [];
		let page = this.map;
		for(let x=0; x!=page.width; ++x) {
			for(let y=0; y!=page.height; ++y) {
				let tile = { terrain:page.get(x, y) };
				if(tile.terrain == MD.OBJ) {
					tile.id = this.objectives.length;
					this.objectives.push({ id:tile.id, x:x, y:y });
				}
				page.set(x,y, tile);
			}
		}

		this.pathFinder = new PathFinder(this.map);
		let self = this;
		this.sim.getSituation(this.credentials.party, null, function(data) {
			self.handleSituation(data);
		});
	}
	this.handleSimEvents = function(events) {
		this.simEvents = events;
		console.groupCollapsed(events.length+' sim events received');
		for(let i=0; i<events.length; ++i) {
			let evt = events[i];
			if(evt.type!='support' && evt.type!='contact')
				console.log(evt);
			switch(evt.type) {
			case 'turn':
				this.turn = evt.turn;
				break;
			}
		}
		console.groupEnd();

		let self=this;
		this.sim.getSituation(this.credentials.party, null, function(data) {
			self.handleSituation(data);
		});
	}
	this.handleSituation = function(data) {
		console.log('situation received, turn', data.turn);

		for(let i=0; i<this.map.data.length; ++i) {
			let tile = this.map.data[i];
			delete tile.unit;
		}

		this.units = { };
		for(let i=0; i<data.units.length; ++i) {
			let unit = data.units[i];
			let tile = this.map.get(unit.x, unit.y);
			tile.unit = this.units[unit.id] = new Unit(unit);
		}

		for(let i=0; i<data.objectives.length; ++i) {
			let objData = data.objectives[i];
			let tile = this.map.get(objData.x, objData.y);
			let obj = this.objectives[tile.id];
			obj.party = objData.party;
			if(objData.production) {
				obj.production = objData.production;
				obj.progress = objData.progress;
			}
			else {
				delete obj.production;
				delete obj.progress;
			}

		}

		this.fov = new MatrixHex(data.fov);
		this.turn = data.turn;
		let self = this;
		if(!data.ordersReceived)
			setTimeout(function() { self.update(); }, 1000);
	}
	this.update = function() { // main method
		//this.updatePolicy();
		this.cleanupMissions();
		this.assignMissions();
		this.generateOrders();
		this.dispatchOrders();
	}
	this.cleanupMissions = function() {
		for(let id in this.missions) {
			let mission = this.missions[id];
			if(mission.isOver())
				mission.cleanup();
			else for(let id in mission.units) {
				let unit = mission.verifyUnit(id);
				if(unit)
					unit.mission = mission.id;
			}
		}
	}
	this.assignMissions = function() {
		console.groupCollapsed('assignMissions turn '+this.turn);
		let expandMissions = [];
		let availableObjs = [];
		let availableUnits = [];

		for(let i=0; i<this.objectives.length; ++i) { // new defense missions needed?
			let obj = this.objectives[i];
			let defenders = MissionDefend.checkNeed(obj, this.map, this.credentials.party);
			let missionId = Mission.makeid(obj);

			if(!defenders) { // no defense mission
				if(obj.party != this.credentials.party) {
					if(missionId in this.missions)
						expandMissions.push(this.missions[missionId]);
					else
						availableObjs.push(obj);
				}
				continue;
			}

			let mission = this.missions[missionId] = (missionId in this.missions) ?
				this.missions[missionId] : new MissionDefend(this, this.map, obj.x, obj.y);

			for(let j=0; j<defenders.length && mission.numUnits<defenders.length; ++j) {
				let unit = defenders[j];
				if(unit.mission==missionId)
					continue;
				if(!unit.mission
					|| !(unit.mission in this.missions)
					|| (this.missions[unit.mission].type!='defend')
					|| mission.numUnits===0)
				{
					mission.assignUnit(unit);
				}
			}
			console.log(mission, mission.str());
		}

		for(let id in this.units) {
			let unit = this.units[id];
			if(unit.party.id!=this.credentials.party)
				continue;
			if(unit.mission) {
				if(unit.mission in this.missions)
					continue;
				else
					delete unit.mission;
			}

			// scan for near enemy:
			if(unit.type.attack>0) {
				let fom = unit.getFieldOfMovement(this.map);
				if(!fom)
					continue;
				for(let i=0; i<fom.length && !unit.mission; ++i) {
					let pos = fom[i];
					let tile = this.map.get(pos.x, pos.y);
					if(!tile.unit || tile.unit.party.id==this.credentials.party)
						continue;
					let mission = new MissionAttack(this, this.map, pos.x, pos.y);
					mission.assignUnit(unit);
					this.missions[mission.id] = mission;
					console.log('mission', mission.str());
				}
			}
			if(!unit.mission)
				availableUnits.push(unit);
		}

		// define new expand missions:
		while(availableUnits.length && expandMissions.length<3 && availableObjs.length) {
			let unit = availableUnits.shift();
			let obj = this.pathFinder.nearestDestination(unit, availableObjs, unit.type.medium);
			if(!obj)
				continue;
			let mission = new MissionExpand(this, this.map, obj.x, obj.y);
			this.missions[mission.id] = mission;
			mission.assignUnit(unit);
			expandMissions.push(mission);
			availableObjs.splice(availableObjs.indexOf(obj), 1);
			console.log('mission', mission.str());
		}

		// assign available units round-robin to expand missions:
		let i=0;
		while(availableUnits.length && expandMissions.length) {
			let mission = expandMissions[i];
			let unit = this.pathFinder.nearestDestination(mission, availableUnits, MD.GROUND);
			if(!unit) {
				console.error('no available unit found with path to', mission.str());
				expandMissions.splice(i, 1);
				continue;
			}
			mission.assignUnit(unit);
			availableUnits.splice(availableUnits.indexOf(unit), 1);
			if(++i >= expandMissions.length)
				i%=expandMissions.length;
		}
		console.groupEnd();
	}

	this.assignProduction = function(obj, orders) {
		let buildProb = this.attitude.buildProbability;
		let sum = 0;
		for(let id in buildProb)
			sum += buildProb[id];
		let score = Math.floor(Math.random()*sum);
		sum = 0;
		let unit = '';
		for(let id in buildProb) {
			sum += buildProb[id];
			if(sum>score) {
				unit = id;
				break;
			}
		}
		console.log('production (',obj.x,',',obj.y,') score:', score, 'unit:', unit);
		orders.push({ type:'production', unit:unit, x:obj.x, y:obj.y });
	}
	this.generateOrders = function() {
		console.groupCollapsed('generateOrders');
		for(let id in this.objectives) {
			let obj = this.objectives[id];
			if(obj.party!=this.credentials.party || obj.progress>0)
				continue;
			this.assignProduction(obj, this.orders);
		}
		for(let id in this.missions) {
			let mission = this.missions[id];
			mission.generateOrders(this.orders);
		}
		console.groupEnd();
	}

	this.dispatchOrders = function() {
		this.sim.postOrders(this.credentials.party, this.orders, this.turn);
		this.orders = [];
	}

	this.init = function() {
		let self = this;
		this.sim.getSimEvents(this.credentials.party, null, function(data) {
			self.handleSimEvents(data); });
		this.sim.getTerrain(this.credentials.party, null, function(data) {
			self.handleTerrain(data);
		});
	}

	this.on = function(event, callback) {
		if(!(event in this.eventListeners))
			this.eventListeners[event] = [];
		this.eventListeners[event].push(callback);
	}
	this.emit = function(event, data) {
		[event, '*'].forEach(function(key) {
			if(key in this.eventListeners) {
				let callbacks = this.eventListeners[key];
				for(let i=0; i<callbacks.length; ++i)
					callbacks[i](event, data);
			}
		}, this);
	}
	this.eventListeners = {};

	this.sim = sim;
	this.map = null;
	this.pathFinder = null;
	this.units = null;
	this.objectives = null;
	this.fov = null;
	this.simEvents = null;
	this.missions = {}; // long term
	this.orders = []; // immediate for this turn
	this.turn = -1;
	this.credentials = credentials;
	this.attitude = Attitude.expansive;

	let self = this;
	setTimeout(function() { self.init(); }, 0);
}
AI.create = function(cmd, id, callback) {
	let params = { mode:'AI', cmd:cmd, id:id };
	let sim = new SimProxy(params, function(credentials, sim) {
		let ai = AI.instance = new AI(sim, credentials);
		callback('credentials', credentials);
		ai.on('error', callback);
	});
	sim.on('error', callback);
}

if(typeof importScripts === 'function') { // webworker
	onmessage = function(e) {
		let params = e.data;
		if(params.cmd=='join' || params.cmd=='resume') {
			AI.create(params.cmd, params.id, function(evt, data){
				postMessage({type:evt, data:data });
			});
		}
	}
}
