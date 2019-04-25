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
		// sort units by proximity to obj:
		let units = [];
		for(let id in this.units) {
			let unit = this.verifyUnit(id);
			if(unit)
				units.push(unit);
		}
		units.sort((a,b)=>{
			let aDist = this.distMap.get(a.x, a.y);
			let bDist = this.distMap.get(b.x, b.y);
			return aDist - bDist;
		});
		let unitsToIgnore = {};
		let occupiedTiles = new MatrixSparse(false);
		units.forEach((unit)=>{
			let fom = unit.getFieldOfMovement(map, unitsToIgnore);
			if(!fom)
				return;
			// find tile in fom with lowest distance:
			let distMin = Number.MAX_VALUE;
			let dest = null;
			fom.forEach((pos)=>{
				let dist = this.distMap.get(pos.x, pos.y);
				if(dist>distMin || occupiedTiles.get(pos.x, pos.y))
					return;
				if(!unit.type.attack) {
					let unit = map.get(pos.x, pos.y).unit;
					if(unit)
						return;
				}
				distMin = dist;
				dest = pos;
			});
			if(dest) {
				let order = { type:'move', unit:unit.id, from_x:unit.x, from_y:unit.y, to_x:dest.x, to_y:dest.y, mission:this.str() };
				//console.log(this.type, order);
				orders.push(order);
				unitsToIgnore[unit.id]=true;
				occupiedTiles.set(dest.x, dest.y, true);
			}
		});
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
	this.distMap = ai.pathFinder.distanceMap(this, MD.GROUND);
}
MissionExpand.prototype = Object.create(Mission.prototype);
MissionExpand.prototype.constructor = MissionExpand;

let MissionAttack = function(ai, map, x,y) {
	this.generateOrders = function(orders) {
		for(let id in this.units) {
			let unit = this.verifyUnit(id);
			if(!unit)
				continue;

			let path = ai.pathFinder.fastestPath(unit, this, unit.type.medium);
			let step = path.length-1;
			while(path[step].cost > 2*unit.type.move && step>1)
				--step;

			let order = { type:'move', unit:id,
				from_x:unit.x, from_y:unit.y, to_x:path[step].x, to_y:path[step].y, mission:this.str() };
			//console.log(this.type, order);
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

		let heatMap = new MatrixSparse(0);
		let attackers = [], defenders = [];
		MissionDefend.nearUnits(this, map, ai.credentials.party, attackers, defenders);
		attackers.forEach((unit)=>{
			ai.pathFinder.fastestPath(unit, this, unit.type.medium).forEach((pos)=>{
				heatMap.incr(pos.x,pos.y, 1);
			 });
		});
		heatMap.incr(this.x, this.y, 6);
		for(let i=0; i<6; ++i) {
			let pos = map.neighbor(this, i);
			heatMap.incr(pos.x, pos.y, 1);
		}

		Object.keys(this.units).forEach((id)=>{
			let unit = this.verifyUnit(id);
			if(!unit || (unit.x==this.x && unit.y==this.y))
				return; // remain on objective

			// intersect unit's field of movement with heatmap, find optimal pos/overlap:
			let fom = unit.getFieldOfMovement(map, attackers);
			if(!fom)
				return;

			let bestValue = heatMap.get(unit.x, unit.y);
			let dest = null;
			for(let i=0; i<fom.length; ++i) {
				let pos = fom[i];
				let currentValue = heatMap.get(pos.x, pos.y);

				let enemy = map.get(pos.x,pos.y).unit;
				if(enemy && enemy.party.id !=  ai.credentials.party) {
					let defense = enemy.getDefense(map);
					let attack = unit.type.attack;
					if(defense >= attack)
						continue;
					if(attack >= defense*1.5)
						currentValue += 1; // prefer promising attacks
				}

				if(currentValue>bestValue) {
					bestValue = currentValue;
					dest = pos;
				}
				// future improvement: check positions blocking multiple paths
			}
			if(dest===null) { // at least move closer to obj
				// find tile in fom with lowest distance:
				let distMin = Number.MAX_VALUE;
				fom.forEach((pos)=>{
					let path = ai.pathFinder.fastestPath(pos, this, unit.type.medium);
					if(!path.length)
						return;
					let dist = path[path.length-1].cost;
					if(dist<distMin) {
						distMin = dist;
						dest = pos;
					}
				});
			}
			if(dest===null)
				return;

			let order = { type:'move', unit:unit.id,
				from_x:unit.x, from_y:unit.y, to_x:dest.x, to_y:dest.y, mission:this.str() };
			//console.log(this.type, order);
			orders.push(order);
			heatMap.set(dest.x, dest.y, 0); // avoid multiple assignments to same dest
		});
	}
	this.isOver = function() {
		return MissionDefend.checkNeed(this, ai.map, ai.credentials.party)===false;
	}
	Mission.call(this, 'defend', ai, map, x, y);
}
MissionDefend.prototype = Object.create(Mission.prototype);
MissionDefend.prototype.constructor = MissionDefend;

MissionDefend.nearUnits = function(obj, map, party, attackers, defenders) {
	let pushUnit = function(unit) {
		if(unit.party.id==party)
			defenders.push(unit);
		else
			attackers.push(unit);
	}

	let unit = map.get(obj.x,obj.y).unit;
	if(unit)
		pushUnit(unit);
	for(let j=0; j<36; ++j) {
		let pos = map.neighbor(obj, j);
		let tile = map.get(pos.x, pos.y);
		if(tile && tile.unit)
			pushUnit(tile.unit);
	}
}

MissionDefend.checkNeed = function(obj, map, party) {
	if(obj.party != party)
		return false;

	let attackers = [], defenders = [];
	MissionDefend.nearUnits(obj, map, party, attackers, defenders);
	if(attackers.length===0)
		return false;

	return defenders.slice(0, Math.ceil(attackers.length*1.33)); // might be []
}

let AI = function(sim, credentials, autoPilot=false, isSynchronous=false) {
	this.handleTerrain = function(data) {
		//console.log(MD.Party[this.credentials.party].name, 'terrain received');

		let map = this.map = new MatrixHex(data);
		this.objectives = [];
		for(let x=0; x!=map.width; ++x) {
			for(let y=0; y!=map.height; ++y) {
				let tile = { terrain:map.get(x, y) };
				if(tile.terrain == MD.OBJ) {
					tile.id = this.objectives.length;
					this.objectives.push({ id:tile.id, x:x, y:y });
				}
				map.set(x,y, tile);
			}
		}

		this.pathFinder = new PathFinder(this.map);
		this.sim.getSituation(this.credentials.party, null, (data)=>{
			this.handleSituation(data);
		});
		this.emit('terrain', data);
	}
	this.handleExternalEvents = function(events) {
		let simEvents = [];

		if(Array.isArray(events)) for(let i=0; i<events.length; ++i) {
			let evt = events[i];
			if(evt.category == 'presence')
				continue; // ignore
			else if(evt.category == 'inconsistency')
				this.handleInconsistencyEvent(evt);
			else simEvents.push(evt);
		}
		if(!simEvents.length) {
			if(isSynchronous)
				this.getSimEvents();
			return;
		}

		this.capturedObjs = {};
		console.log(MD.Party[this.credentials.party].name, simEvents.length+' sim events received');
		for(let i=0; i<simEvents.length; ++i) {
			let evt = simEvents[i];
			switch(evt.type) {
			case 'turn': {
				let newTurn = parseInt(evt.turn);
				if(newTurn != this.turn) {
					this.orders = [];
					this.ordersGenerated = false;
					this.consistencyState.ordersSent = false;
				}
				this.turn = this.consistencyState.turn = newTurn;
				break;
			}
			case 'capture':
				if(evt.party == this.credentials.party && evt.from)
					this.capturedObjs[evt.id] = true;
				break;
			case 'gameOver':
			case 'support':
			case 'contact':
				continue; // ignore
			}
			//console.log(evt);
		}

		this.sim.getSituation(this.credentials.party, null, (data)=>{
			this.handleSituation(data);
		});
		this.emit('simEvents', events);
	}
	this.handleInconsistencyEvent = function(evt) {
		if(evt.type=='getSituation')
			this.sim.getSituation(this.credentials.party, null, (data)=>{ this.handleSituation(data); });
		else if(evt.type=='postOrders')
			this.dispatchOrders();

		console.warn('inconsistency event type:', evt.type, 'turn:', evt.turn, 'ordersReceived:', evt.ordersReceived);
	}

	this.handleSituation = function(data) {
		console.log(MD.Party[this.credentials.party].name, 'situation received, turn', data.turn);

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

		let newTurn = parseInt(data.turn);
		if(newTurn != this.turn) {
			this.orders = [];
			this.ordersGenerated = false;
			this.consistencyState.ordersSent = false;
		}
		this.turn = this.consistencyState.turn = newTurn;

		this.state = data.state;
		this.consistencyState.ordersSent = data.ordersReceived;
		if(!data.ordersReceived)
			setTimeout(()=>{ this.update(); }, 500+Math.floor(Math.random()*1000));
		this.emit('situation', data);
	}
	this.update = function() { // main method
		if(this.state=='over')
			return;
		//this.updatePolicy();
		this.cleanupMissions();
		this.assignMissions();
		this.generateOrders();
		this.validateOrders();
		if(!this.dispatchOrdersBlocked)
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
		//console.log(MD.Party[this.credentials.party].name, 'assignMissions turn '+this.turn);
		let expandMissions = [];
		let availableObjs = [];
		let availableUnits = [];

		for(let i=0; i<this.objectives.length; ++i) { // new defense missions needed?
			let obj = this.objectives[i];
			let defenders = MissionDefend.checkNeed(obj, this.map, this.credentials.party);
			let missionId = Mission.makeid(obj);

			if(defenders===false) { // no defense mission
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
			//console.log(mission, mission.str());
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
					//console.log('mission', mission.str());
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
			//console.log('mission', mission.str());
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
		let unit = (obj.id in this.capturedObjs) ? 'inf' : '';
		let missionId = Mission.makeid(obj);
		if(unit === ''
			&& (missionId in this.missions)
			&& this.missions[missionId].type=='defend')
			unit = 'inf';

		if(unit==='') {
			let buildProb = this.attitude.buildProbability;
			let sum = 0;
			for(let id in buildProb)
				sum += buildProb[id];
			let score = Math.floor(Math.random()*sum);
			sum = 0;
			for(let id in buildProb) {
				sum += buildProb[id];
				if(sum>score) {
					unit = id;
					break;
				}
			}
		}
		//console.log('production (',obj.x,',',obj.y,') unit:', unit);
		orders.push({ type:'production', unit:unit, x:obj.x, y:obj.y });
	}

	this.generateOrders = function() {
		console.log(MD.Party[this.credentials.party].name, 'generateOrders');
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
		this.ordersGenerated = true;
		//console.groupEnd();
	}

	this.validateOrders = function() {
		let unitsHavingOrders = {};
		let invalidOrders = [];
		for(let i=0; i < this.orders.length; ++i) {
			let order = this.orders[i];
			// { type:'move', unit:unit.id, from_x:unit.x, from_y:unit.y, to_x:dest.x, to_y:dest.y }
			if(order.type !== 'move')
				continue;

			// move orders length 0 / beyond movement range:
			if(order.from_x === order.to_x && order.from_y === order.to_y) {
				console.warn("validateOrders: move from/to are identical:", order);
				invalidOrders.push(i);
			}
			else {
				let dist = MatrixHex.distHex({x:order.from_x, y:order.from_y},{x:order.to_x, y:order.to_y});
				let unit = this.units[order.unit];
				if(dist > unit.type.move) {
					console.warn("validateOrders: unit destination beyond movement range", order, unit.serialize())
					invalidOrders.push(i);
				}	
			}

			// multiple orders per unit:
			if(order.unit in unitsHavingOrders) {
				console.groupCollapsed("validateOrders: multiple orders for a single unit");
				console.warn(i, order);
				let firstIndex = unitsHavingOrders[order.unit];
				console.warn(firstIndex, this.orders[firstIndex]);
				console.groupEnd();
				invalidOrders.push(firstIndex); // or i
			}
			else unitsHavingOrders[order.unit] = i;
		}

		if(!invalidOrders.length)
			return;
		invalidOrders = [...new Set(invalidOrders)].sort().reverse();
		for(let i=0; i<invalidOrders.length; ++i)
			this.orders.splice(invalidOrders[i], 1);
	}

	this.dispatchOrders = function() {
		this.sim.postOrders(this.credentials.party, this.orders, this.turn);
		this.consistencyState.ordersSent = true;
		if(this.autoPilot)
			this.dispatchOrdersBlocked = true;
	}

	this.unblockDispatchOrders = function() {
		if(this.ordersGenerated)
			this.dispatchOrders();
		else
			this.dispatchOrdersBlocked = false;
	}

	this.getSimEvents = function() {
		if(this.state=='over')
			return;
		this.sim.getSimEvents(this.credentials.party, this.consistencyState, (data)=>{
			this.handleExternalEvents(data);
		});
	}

	this.init = function() {
		if(!isSynchronous)
			this.getSimEvents();
		this.sim.getTerrain(this.credentials.party, null, (data)=>{
			this.handleTerrain(data);
		});
	}

	this.on = function(event, callback) {
		if(!(event in this.eventListeners))
			this.eventListeners[event] = [];
		this.eventListeners[event].push(callback);
	}
	this.emit = function(event, data) {
		[event, '*'].forEach((key)=>{
			if(key in this.eventListeners) {
				let callbacks = this.eventListeners[key];
				for(let i=0; i<callbacks.length; ++i)
					callbacks[i](event, data);
			}
		});
	}

	this.state = 'init';
	this.sim = sim;
	this.map = null;
	this.pathFinder = null;
	this.units = null;
	this.objectives = null;
	this.fov = null;
	this.capturedObjs = {};
	this.missions = {};
	this.orders = [];
	this.ordersGenerated = false;
	this.turn = 1;
	this.consistencyState = { turn:this.turn, ordersSent:false, mode:'AI' };
	this.credentials = credentials;
	this.autoPilot = autoPilot;
	this.dispatchOrdersBlocked = false;
	this.attitude = Attitude.expansive;
	this.eventListeners = {};

	setTimeout(()=>{ this.init(); }, 0);
}
AI.instances = [];

AI.create = function(params, callback, allEvents) {
	params.name = params.party ? ('AI_'+params.party) : 'AI';
	params.mode = 'AI';
	let sim = new SimProxy(params, (credentials, sim)=>{
		let ai = new AI(sim, credentials, params.autoPilot, params.isSynchronous);
		AI.instances.push(ai);
		callback('credentials', credentials);
		ai.on(allEvents ? '*' : 'error', callback);
		if((ai.autoPilot || params.isSynchronous) && !allEvents)
			ai.on('simEvents', callback);
	});
	sim.on('error', callback);
}

AI.createMulti = function(params, callback, allEvents) {
	let parties = params.party;
	let simEventsRequested = -1;
	let cb = function(event, data) {
		if(event=='credentials' && simEventsRequested<0) {
			AI.instances[++simEventsRequested].getSimEvents(); // initiate sim event listening
		}
		if(event=='simEvents')
			AI.instances[++simEventsRequested % AI.instances.length].getSimEvents();
		else
			callback(event, data);
	}
	for(let i=0; i<parties.length; ++i) {
		let p = { cmd:params.cmd, party:parties[i], isSynchronous:true,
			id:Array.isArray(params.id) ? params.id[i] : params.id };
		AI.create(p, cb, allEvents);
	}
}

if(typeof importScripts === 'function') { // webworker
	onmessage = function(e) {
		let params = e.data;
		if(params.cmd=='join' || params.cmd=='resume') {
			let method = Array.isArray(params.party) ? 'createMulti' : 'create';
			AI[method](params, (evt, data)=>{
				postMessage({ type:evt, data:data });
			});
		}
		else if(params.cmd == 'postOrders')
			for(let i=0; i<AI.instances.length; ++i)
				if(AI.instances[i].autoPilot)
					AI.instances[i].unblockDispatchOrders();
	}
}
