if(typeof require !== 'undefined') {
	var shared = require('./static/shared');
	MapHex = shared.MapHex;
	MatrixHex = shared.MatrixHex;
	MatrixSparse = shared.MatrixSparse;
}

//--- Sim ----------------------------------------------------------
function Sim(params, callback) {
	/// pure terrain
	this.getTerrain = function(party, params, callback) {
		var terrain = this.map.getTerrain(params.page ? params.page : 0, true);
		callback(terrain);
		return false;
	}

	/// military situation, as obvious to a party, primary means of synchronizing clients
	this.getSituation = function(partyId, params, callback) {
		var pageSz = this.map.pageSz;
		var party = this.parties[partyId];
		var fov = party.fov;
		var units=[], objs=[];
		var ordersReceived = party.orders!==null;

		for(var y=0; y!=pageSz; ++y) for(var x=0; x!=pageSz; ++x) {
			var tile = this.map.get(x,y);
			if(this.state!='over' && fov && fov.get(x,y)===0) {  // out of sight
				if(tile.terrain==MD.OBJ && (tile.id in party.knownObjectives))
					objs.push({x:x, y:y, party:party.knownObjectives[tile.id]});
				continue;
			}
			if(tile.unit)
				units.push(tile.unit.serialize());
			if(tile.terrain==MD.OBJ && tile.party) {
				party.knownObjectives[tile.id] = tile.party;
				var obj = {x:x, y:y, party:tile.party};
				if(tile.party == partyId) {
					obj.production = tile.production;
					obj.progress = tile.progress;
				}
				objs.push(obj);
			}
		}
		let situation = { units:units, objectives:objs, fov:fov.serialize(true),
			state:this.state, turn:this.turn, ordersReceived:ordersReceived, numPartiesMax:this.numParties };
		if(this.outcome)
			for(let key in this.outcome)
				situation[key] = this.outcome[key];
		callback(situation);
		return false;
	}

	this.checkConsistency = function(party, params) {
		if(this.state == 'over')
			return '';
		if(typeof params != 'object') {
			console.warn('consistency state expected as params of party', party.name);
			return 'sendConsistencyState';
		}
		params.turn = parseInt(params.turn);
		if(params.turn != this.turn && params.turn+1 != this.turn) {
			console.warn(party.name, 'inconsistent client state. Turn client:', params.turn, 'sim:', this.turn);
			return 'getSituation';
		}
		if(params.turn == this.turn) { // todo, handle orders arriving a little bit later
			let ordersSent = params.ordersSent==='true';
			let ordersReceived = party.orders !== null;
			if(ordersSent != ordersReceived) {
				console.warn(party.name, 'inconsistent client state. Orders sent:', ordersSent, 'received:', ordersReceived);
				if(!ordersReceived)
					return 'postOrders';
			}
		}
		return '';
	}

	/// long polling event listener
	this.getSimEvents = function(partyId, params, callback) {
		let party = this.parties[partyId];
		let inconsistency = this.checkConsistency(party, params);
		if(inconsistency)
			callback([{ type:inconsistency, category:'inconsistency', turn:this.turn, ordersReceived: party.orders !== null }]);
		else if(!party.events)
			this.simEventListeners[partyId]=callback;
		else {
			callback(party.events);
			party.events=null;
			delete this.simEventListeners[partyId];
		}
		return false;
	}

	this.postOrders = function(party, data, callback) {
		if(this.state!='running') {
			if(callback)
				callback('Locked', 423);
			return false;
		}

		var turn = data.turn;
		var orders = data.orders;
		if(this.devMode && orders && orders.length==1 && orders[0].type=='forceEvaluate')
			return this._evaluateSimEvents();

		if(!this._validateOrders(party, orders, turn)) {
			if(callback)
				callback('orders semantically invalid', 400);
			return false;
		}
		this.parties[party].orders = orders = this._atomizeOrders(orders);
		this.lastUpdateTime = new Date()/1000.0;

		if(this._isReadyForEvaluation())
			this._evaluateSimEvents();
		if(callback)
			callback();
		return true;
	}

	this._postPresenceEvent = function(partyId, type, params) {
		let evt = { type:type, category:'presence', party:partyId };
		if(params) for(let key in params)
			evt[key] = params[key];
		if(type=='join') {
			let party = this.parties[partyId];
			if(!party)
				return console.error('invalid party id', partyId);
			party.events = null; // events before join do not matter
			if(params) {
				if(params.name)
					party.name = params.name;
				if(params.mode)
					party.mode = params.mode;
			}
		}
		this._dispatchEvents([evt]);
	}

	this._isCapitulation = function(orders) {
		return Array.isArray(orders) && orders.length==1 && orders[0].type=='capitulate';
	}

	this._isReadyForEvaluation = function() {
		let tNow = new Date()/1000;
		if(tNow >= this.turnStartTime+this.timePerTurn)
			return true;

		let allOrdersReceived = true;
		let capitulateReceived = false;
		for(let key in this.parties) {
			let orders = this.parties[key].orders;
			if(orders===null)
				allOrdersReceived = false;
			else if(this._isCapitulation(orders))
				capitulateReceived = true;
		}
		return allOrdersReceived || capitulateReceived;
	}

	this._validateOrders = function(party, orders, turn) {
		if(!(party in this.parties)) {
			console.warn('validateOrders: invalid party', party);
			return false;
		}
		if(turn!=this.turn) {
			console.warn('validateOrders: invalid turn', turn, '!=', this.turn);
			return false;
		}
		if(this._isCapitulation(orders))
			return orders[0].party == party;

		if(this.parties[party].orders) {
			console.warn('validateOrders: orders already received');
			return false;
		}
		if(!orders.length)
			return true;

		var numInvalidOrders = 0;
		var unitsHavingOrders = {}; // ensure that at most one command per unit
		for(var i=0; i<orders.length; ++i) {
			var order = orders[i];

			var unit = order.unit;
			if(unit && order.type!='production') {
				if(unit in unitsHavingOrders) {
					console.warn("validateOrders: multiple orders for a single unit:", order);
					delete orders[i];
					++numInvalidOrders;
					continue;
				}
				unitsHavingOrders[unit] = true;
			}

			var orderValid = false;
			switch(order.type) {
			case 'move': {
				var unit = this.map.get(order.from_x, order.from_y).unit;
				if(!unit || unit.id != order.unit) {
					console.warn('validateOrders: unit not found at location', order);
					break;
				}
				if(unit.party.id != party) {
					console.warn('validateOrders: unit does not obey to party', party);
					break;
				}
				var distance = MatrixHex.distHex(unit, { x:order.to_x, y:order.to_y });
				if(distance<1 || distance>unit.type.move) {
					console.warn('validateOrders: unit destination beyond movement range', order);
					break;
				}
				orderValid = true;
				break;
			}
			case 'production': {
				var tile = this.map.get(order.x, order.y);
				if(tile && tile.party==party && tile.terrain==MD.OBJ && (order.unit in MD.Unit))
					orderValid = true;
				else
					console.warn('validateOrders: location does not obey to production orders', order);
				break;
			}
			default:
				break;
			}
			if(!orderValid) {
				delete orders[i];
				++numInvalidOrders;
			}
		}
		return numInvalidOrders < orders.length;
	}

	this._atomizeOrders = function(orders) {
		var ordersOut = [];
		var unitsToIgnore = {};
		for(var j=0; j<orders.length; ++j) {
			var order = orders[j];
			if(!order)
				continue;
			if(order.type!='move') {
				ordersOut.push(order);
				continue;
			}

			var unit = this.map.get(order.from_x, order.from_y).unit;
			var path = unit.getPath(this.map.page, order.to_x, order.to_y, unitsToIgnore);
			var from = unit;
			for(var i=0, end=path.length; i!=end; ++i) {
				var to = path[i];
				ordersOut.push({type:'move', unit:order.unit, from_x:from.x, from_y:from.y, to_x:to.x, to_y:to.y});
				from = to;
				unitsToIgnore[order.unit] = true;
			}
		}
		return ordersOut;
	}

	this._mergeOrders = function() {
		var ordersByParty = [ ];
		for(var key in this.parties) {
			if(this.parties[key].orders!==null) {
				ordersByParty.push(this.parties[key].orders);
				this.parties[key].orders = null;
			}
		}

		var numParties = ordersByParty.length;
		var mergedOrders = [];
		var orderProcessed;
		do {
			orderProcessed = false;
			for(var i=0; i<numParties; ++i) {
				var orders = ordersByParty[(this.turn+i)%numParties]; // alternate initiative
				if(!orders.length)
					continue;
				mergedOrders.push(orders.shift());
				orderProcessed = true;
			}
		} while(orderProcessed);
		return mergedOrders;
	}

	this._evaluteContactEvents = function(unit, evt, events) {
		for(var party in this.parties) {
			var fov = this.parties[party].fov;

			if(unit.party.id == party) { // scan unit's new fov for newly discovered units:
				var unitFov = new MatrixSparse(0);
				unit.getFieldOfView(this.map, unitFov);
				for(var i=0; i<36; ++i) {
					var nb = MatrixHex.neighbor(unit, i);
					if(!nb || fov.get(nb.x, nb.y)!==0 || unitFov.get(nb.x, nb.y)==0)
						continue;
					var tile = this.map.get(nb.x, nb.y);
					if(tile.unit)
						events.push({type:'contact', x:nb.x, y:nb.y, party:party, unit:tile.unit.serialize()});
				}
				continue;
			}

			var fromVisible = fov.get(evt.from_x, evt.from_y)!==0;
			var toVisible = fov.get(evt.to_x, evt.to_y)!==0;

			if(!fromVisible && toVisible) // insert before move
				events.splice(events.length-1, 0, {type:'contact', x:evt.from_x, y:evt.from_y, party:party, unit:unit.serialize()});
			else if(fromVisible && !toVisible)
				events.push({type:'contactLost', x:evt.from_x, y:evt.from_y, party:party, unit:unit.id});
		}
	}

	this._evaluateSimEvents = function() {
		console.log('--', this.id, 'evaluate turn', this.turn, '--');
		var events = [ ];
		var orders = this._mergeOrders();
		for(var i=0; i<orders.length; ++i) {
			var order = orders[i];
			switch(order.type) {
			case 'move': {
				var unit = this.map.get(order.from_x, order.from_y).unit;
				if( !unit || unit.id != order.unit
					|| !this.map.unitMove(unit, { x:order.to_x, y:order.to_y }, events) )
				{
					//console.log('move failed', order);
					continue;
				}
				events.push(order);
				if((unit.party.id in this.parties) && this.parties[unit.party.id].fov)
					this.parties[unit.party.id].fov.set(order.to_x, order.to_y, 1);
				this._evaluteContactEvents(unit, order, events);

				var dest = this.map.get(order.to_x, order.to_y);
				var opponent = dest.unit;
				if(opponent && !this._evaluateCombat(unit, { x:order.from_x, y:order.from_y }, opponent, events)) {
					if(dest.terrain == MD.OBJ && (unit.party.id in this.parties)) {
						let party = this.parties[unit.party.id];
						party.knownObjectives[dest.id] = opponent.party.id;
					}
					continue; // attacker lost
				}

				dest.unit = unit; // attacker won
				if(dest.terrain == MD.OBJ)
					this._capture(dest, unit, events);
				break;
			}
			case 'capitulate':
				events = [order];
				this.outcome = { capitulated:order.party };
				i=orders.length;
				break;
			case 'production': {
				var tile = this.map.get(order.x, order.y);
				if(tile.production != order.unit) {
					tile.production = order.unit;
					tile.progress = 0;
				}
				break;
			}
			default:
				console.error('invalid order', order);
			}
		}

		var isGameOver = this._isGameOver(events);
		if(!isGameOver) {
			events.push({type:'turn', turn:this.turn+1});
			this._updateProduction(events);
		}
		this._dispatchEvents(events);
		if(isGameOver)
			return;

		++this.turn;
		this.turnStartTime = this.lastUpdateTime = new Date()/1000.0;
		setTimeout((turn)=>{
			if(this.turn!=turn)
				return;
			console.log("turn", turn, "timeout");
			this._evaluateSimEvents();
		}, this.timePerTurn*1000, this.turn);
		for(var party in this.parties)
			this.parties[party].fov = this.map.getFieldOfView(party);
	}

	this._dispatchEvents = function(events) {
		if(!events || !events.length)
			return;
		for(var key in this.parties) {
			var party = this.parties[key];
			var evts = this._filterEvents(events, key);
			if(!evts.length)
				continue;

			if(!(key in this.simEventListeners)) {
				party.events = evts;
				continue;
			}
			party.events = null;

			var listener = this.simEventListeners[key];
			if(!listener)
				continue;
			if(typeof listener === 'function') {
				listener(evts);
				delete this.simEventListeners[key];
			}
			else if(typeof listener === 'object') {
				if(typeof listener.emit === 'function')
					listener.emit('events', evts);
			}
		}
		this.simEventCounter += events.length;
	}

	this._filterEvents = function(events, party) {
		var evts = [];
		var fov = this.parties[party].fov;

		for(var i=0, end=events.length; i!=end; ++i) {
			var evt = events[i];
			
			if(evt.category=='presence') {
				if(evt.party != party)
					evts.push(evt);
				continue;
			}

			if(('party' in evt) && evt.party == party) {
				evts.push(evt);
				continue;
			}
			if(evt.type=='contactLost') // sole recipient already handled by preceding cond evt.party == party
				continue;

			var visible = false, hasLocation = false;
			if(('x' in evt) && ('y' in evt)) {
				visible = fov.get(evt.x, evt.y)!==0;
				hasLocation = true;
			}
			if(!visible && ('from_x' in evt) && ('from_y' in evt)) {
				visible = fov.get(evt.from_x, evt.from_y)!==0;
				hasLocation = true;
			}
			if(!visible && ('to_x' in evt) && ('to_y' in evt)) {
				visible = fov.get(evt.to_x, evt.to_y)!==0;
				hasLocation = true;
			}
			if(visible || !hasLocation) {
				evts.push(evt);
				continue;
			}
		}
		return evts;
	}

	this._evaluateCombat = function(attacker, attackFrom, defender, events) {
		var attack = attacker.type.attack;
		var defense = defender.getDefense(this.map);

		// evaluate support:
		for(var i=0; i<18; ++i) {
			var nbPos = MatrixHex.neighbor(defender, i);
			if(nbPos.x == attackFrom.x && nbPos.y == attackFrom.y)
				continue;

			var unit = this.map.get(nbPos.x, nbPos.y).unit;
			if(!unit || !unit.type.support)
				continue;

			var distance = (i<6) ? 1 : 2;
			if(unit.type.range<distance)
				continue;

			if(unit.party.id == attacker.party.id)
				attack += unit.type.support;
			else if(unit.party.id == defender.party.id)
				defense += unit.type.support;
			else
				continue;
			events.push({ type:'support', x:defender.x, y:defender.y, unit:unit.id, origin_x:unit.x, origin_y:unit.y});
		}

		// evaluate result:
		var odds = attack / (attack+defense);
		var score = Math.floor(Math.random()*(attack+defense));
		var event = { type:'combat', attack:attack, defense:defense, score:score, x:defender.x, y:defender.y };

		var winner, looser;
		if(score < attack) {
			event.winner = attacker.id;
			event.looser = defender.id;
			winner = attacker;
			looser = defender;
		}
		else {
			odds = 1.0-odds;
			event.winner = defender.id;
			event.looser = attacker.id;
			winner = defender;
			looser = attacker;
		}
		events.push(event);

		// update statistics:
		let winnerParty = (winner.party.id in this.parties) ? this.parties[winner.party.id] : null;
		let looserParty = (looser.party.id in this.parties) ? this.parties[looser.party.id] : null;
		if(winnerParty) {
			++winnerParty.victories;
			winnerParty.odds += odds;
		}
		if(looserParty) {
			++looserParty.defeats;
			looserParty.odds += 1.0-odds;
		}

		// evaluate surrender or retreat:
		score = Math.floor(Math.random()*10);
		var looserSurrenders = (score >= looser.type.retreat);
		var retreatPos = null;

		if(!looserSurrenders) {
			if(looser == attacker) { // attacker retreats to original position
				retreatPos = attackFrom;
			}
			else { // defender tries to retreat
				var attackVector = MatrixHex.angleHex(attackFrom, defender);
				var dir2 = (attackVector+1)%6, dir3 = (attackVector+5)%6;
				var flip = Math.random()<0.5;
				var retreatPositions = [
					MatrixHex.polar2hex(looser, attackVector),
					MatrixHex.polar2hex(looser, flip ?  dir3 : dir2),
					MatrixHex.polar2hex(looser, flip ?  dir2 : dir3)
				];

				for(var i=0; i<retreatPositions.length && retreatPos === null; ++i) {
					var tile = this.map.get(retreatPositions[i].x, retreatPositions[i].y);
					if(!looser.isAccessible(tile) || tile.unit || looser.isBlocked(this.map, retreatPositions[i], tile))
						continue;
					retreatPos = retreatPositions[i];
				}
			}
		}

		if(retreatPos && this.map.unitMove(looser, retreatPos, events)) {
			events.push({ type:'retreat', score:score, from_x:winner.x, from_y:winner.y,
				to_x:retreatPos.x, to_y:retreatPos.y, unit:looser.id });
			var dest = this.map.get(retreatPos.x, retreatPos.y);
			dest.unit = looser;
			if(dest.terrain == MD.OBJ)
				this._capture(dest, looser, events);
		}
		else {
			events.push({ type:'surrender', score:score, x:looser.x, y:looser.y,
				unit:looser.id });
			if(looserParty)
				--looserParty.units;
		}
		return looser==defender;
	}

	this._capture = function(dest, unit, events) {
		if(dest.party==unit.party.id)
			return;
		let from = dest.party;
		if(from in this.parties) {
			let party = this.parties[from]; 
			--party.objectives;
			party.knownObjectives[dest.id] = unit.party.id;
		}
		dest.party = unit.party.id;
		dest.progress = -1;
		dest.production = 'inf';
		if(dest.party in this.parties) {
			let party = this.parties[dest.party]; 
			++party.objectives;
			party.knownObjectives[dest.id] = unit.party.id;
		}
		events.push({type:'capture', x:unit.x, y:unit.y, id:dest.id, party:unit.party.id, from:from});
	}

	this._isGameOver = function(events) {
		if(this.state == 'over')
			return true;

		const capitulated = (this.outcome && this.outcome.capitulated) ? this.outcome.capitulated : false;
		let loosers = [];
		let winners = [];
		let humanLoosers = false;
		let numObjectivesMax = 0;

		for(let key in this.parties) {
			let party = this.parties[key];
			if(!party.objectives || key==capitulated) {
				loosers.push(key);
				if(party.mode != 'AI')
					humanLoosers = true;
				continue;
			}
			winners.push(key);
			if(party.objectives > numObjectivesMax)
				numObjectivesMax = party.objectives;
		}
		if(winners.length>1 && !humanLoosers && numObjectivesMax<this.numObjectivesVictory)
			return false;

		if(winners.length>1) { // compare number of objectives:
			for(let i = winners.length; i-->0; ) {
				let party = this.parties[winners[i]];
				if(party.objectives == numObjectivesMax)
					continue;
				loosers.push(winners[i]);
				winners.splice(i, 1);
			}
		}
		let stats = {};
		for(let key in this.parties) {
			let party = this.parties[key];
			let odds = (party.victories+party.defeats>0) ? party.odds/(party.victories+party.defeats) : 0.0;
			stats[key] = { objectives:party.objectives, units:party.units, unitsBuilt:party.unitsBuilt,
				victories:party.victories, defeats:party.defeats, odds:odds }
		}
		this.outcome = { winners:winners, loosers:loosers, capitulated:capitulated, stats:stats };
		events.push({ type:'gameOver', winners:winners, loosers:loosers, capitulated:capitulated, stats:stats });
		this.state = 'over';
		return true;
	}

	this._updateProduction = function(events) {
		var pageSz = this.map.pageSz;
		for(var y=0; y!=pageSz; ++y) for(var x=0; x!=pageSz; ++x) {
			var tile = this.map.get(x,y);
			if(!tile.production || !tile.party)
				continue;
			++tile.progress;
			var unitType = MD.Unit[tile.production];
			if(tile.progress >= unitType.cost) {
				var unit = tile.unit ? null : { x:x, y:y };
				var offset = Math.floor(Math.random()*6);
				for(var i=0; unit===null && i<6; ++i) { // check immediate vicinity
					var unit = MatrixHex.polar2hex({ x:x, y:y }, (i+offset)%6, 1);
					var nbTile = this.map.get(unit.x, unit.y);
					if(!nbTile || nbTile.unit || !MD.isNavigable(nbTile.terrain, unitType))
						unit = null;
				}
				if(!unit)
					events.push({type:'productionBlocked', x:x, y:y, party:tile.party });
				else {
					unit.type = tile.production;
					unit.party = tile.party;
					unit = this.map.unitAdd(unit);
					events.push({type:'production', x:unit.x, y:unit.y, origin_x:x, origin_y:y,
						unit:unit.serialize()});
					tile.progress = 0;
					++this.parties[tile.party].units;
					++this.parties[tile.party].unitsBuilt;
				}
			}
		}
	}

	this._serialize = function() {
		var data = {
			scenario: this.scenario,
			timePerTurn: this.timePerTurn,
			devMode: this.devMode,
			turn: this.turn,
			turnStartTime: this.turnStartTime,
			lastUpdateTime: this.lastUpdateTime,
			simEventCounter: this.simEventCounter,
			map: this.map.serialize(),
			numObjectivesVictory: this.numObjectivesVictory,

			parties: {},
			state: this.state
		};
		for(var key in this.parties) {
			var party = this.parties[key];
			data.parties[key] = { objectives:party.objectives, units:party.units,
				unitsBuilt:party.unitsBuilt, orders:party.orders, name:party.name, mode:party.mode,
				knownObjectives:(party.knownObjectives ? party.knownObjectives : {})};
		}
		if(this.outcome)
			data.outcome = this.outcome;
		return data;
	}
	this._deserialize = function(data) {
		// CAVEAT: no changes that prohibit deserialization of existing match serializations!
		this.scenario = data.scenario;
		this.timePerTurn = data.timePerTurn;
		this.devMode = data.devMode;
		this.turn = data.turn;
		this.turnStartTime = data.turnStartTime;
		this.lastUpdateTime = data.lastUpdateTime;
		this.simEventCounter = data.simEventCounter;
		this.map = new MapHex(data.map);
		this.parties = data.parties;
		this.numParties = 0;
		for(var key in this.parties) {
			this.parties[key].fov = this.map.getFieldOfView(key);
			++this.numParties;
			if(!('unitsBuilt' in this.parties[key]))
				this.parties[key].unitsBuilt = 0;
		}
		if('outcome' in data)
			this.outcome = data.outcome;
		if('numObjectivesVictory' in data)
			this.numObjectivesVictory = data.numObjectivesVictory;
		else
			this.numObjectivesVictory = Math.ceil(this.map.getObjectives().length * 0.66);
		this.state = data.state;
	}

	this._initStats = function(scenario) {
		var parties = this.parties = {};
		this.numParties = 0;
		for(var key in scenario.starts) {
			++this.numParties;
			parties[key] = { objectives:1, units:0, unitsBuilt:0,
				victories:0, defeats:0, odds:0.0,
				orders:null, name:MD.Party[key].name, mode:null,
				fov:this.map.getFieldOfView(key), knownObjectives:{} };
			for(var partyId in scenario.starts)
				parties[key].knownObjectives[scenario.starts[partyId]] = parseInt(partyId);
		}
		for(var key in scenario.units) {
			var unit = scenario.units[key];
			if(unit.party in parties)
				++parties[unit.party].units;
		}
	}

	this._init = function(params) {
		var defaults = {
			scenario:'baiazul',
			pageSz:32,
			fractionObjectivesVictory:0.66,
			timePerTurn: 86400, // 1 day
			devMode: 1,
			id:''
		};
		for(var key in defaults)
			this[key] =(key in params) ?
				isNaN(parseInt(params[key])) ? params[key] : parseInt(params[key])
				: defaults[key];

		var scenario = {};
		if(!(this.scenario in Sim.scenarios))
			scenario.seed = this.scenario;
		else {
			var scn = Sim.scenarios[this.scenario];
			for(var key in scn) {
				var value = scn[key];
				if(typeof value == 'object') // deepcopy
					scenario[key] = JSON.parse(JSON.stringify(value));
				else
					scenario[key] = value;
			}
		}

		if(typeof params.parties == 'object') // remove disabled parties/starts
			for(let key in params.parties)
				if(params.parties[key]== -1)
					delete scenario.starts[key];

		this.map = new MapHex(scenario);
		this.numObjectivesVictory
			= Math.ceil(this.map.getObjectives().length * this.fractionObjectivesVictory);
	
		this._initStats(scenario);
		this.simEventCounter = 0;
		this.turn = 1;
		this.turnStartTime = this.lastUpdateTime = new Date()/1000.0;
		this.state = 'running';
	}

	this.state = 'init';
	if('turn' in params)
		this._deserialize(params);
	else
		this._init(params);
	this.simEventListeners = { };
	if(callback)
		callback({ party:params.party ? params.party : 1 }, this);
}

Sim.loadScenarios = function(path) {
	var Storage = require('./DiskStorage');
	var storage = new Storage(path);
	var scenarios = Sim.scenarios = {};
	var visible = Sim.visibleScenarios = {};
	var numScenarios = 0;
	storage.keys().forEach(function(id) {
		var data = storage.getItem(id);
		if(data) {
			scenarios[id] = data;
			++numScenarios;
			if(!('visibility' in data)||data.visibility!='hidden')
				visible[id] = data;
		}
	});
	console.log(numScenarios, 'scenarios loaded from', path);
}

if(typeof module == 'object' && module.exports)
	module.exports = Sim;
