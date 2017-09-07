if(typeof require !== 'undefined') {
	var shared = require('./shared');
	MapHex = shared.MapHex;
	MatrixHex = shared.MatrixHex;
	MatrixSparse = shared.MatrixSparse;
}

//--- Sim ----------------------------------------------------------
function Sim(params, callback) {
	/// pure terrain
	this.getTerrain = function(party, params, callback) {
		var terrain = this.map.getTerrain(params.page ? params.page : 0);
		terrain.data = MatrixHex.rleEncode(terrain.data);
		callback(terrain);
	}
	/// military situation, as obvious to a party, primary means of synchronizing clients
	this.getSituation = function(party, params, callback) {
		var pageSz = this.map.pageSz;
		var fov = party ? this.parties[party].fov : null;
		var units=[], objs=[];
		var ordersReceived = this.parties[party].orders!==null;

		for(var y=0; y!=pageSz; ++y) for(var x=0; x!=pageSz; ++x) {
			var tile = this.map.get(x,y);
			if(fov && fov.get(x,y)===0)
				continue; // out of sight
			if(tile.unit)
				units.push(tile.unit.serialize());
			if(tile.party) {
				var obj = {x:x, y:y, party:tile.party};
				if(tile.party == party)
					obj.progress = tile.progress;
				objs.push(obj);
			}
		}
		callback({ units:units, objectives:objs, fov:fov.serialize(true),
			state:this.state, turn:this.turn, ordersReceived:ordersReceived });
	}
	/// long polling event listener
	this.getSimEvents = function(party, params, callback) {
		this.simEventListeners[party]=callback;
		this.state='running'; // at least one listener
	}

	this.postOrders = function(party, orders, callback) {
		if(this.state!='running') {
			if(callback)
				callback('Locked', 423);
			return;
		}

		if(typeof orders=='object' && !Array.isArray(orders))
			orders = orders.orders;
		if(typeof orders=='string') try {
			orders = JSON.parse(orders);
		}
		catch(e) {
			console.error('postOrders JSON.parse', e.name+':', e.message);
			if(callback)
				callback('invalid orders format', 400);
			return;
		}
		if(!orders)
			return;

		if(!this._validateOrders(party, orders)) {
			if(callback)
				callback('orders semantically invalid', 400);
			return;
		}
		this.parties[party].orders = this._atomizeOrders(orders);

		if(this._isReadyForEvaluation())
			this._evaluateSimEvents();
		if(callback)
			callback();
	}

	this._isReadyForEvaluation = function() {
		if(this.devMode)
			return true;
		var tNow = new Date()/1000;
		if(tNow >= this.turnStartTime+this.timePerTurn)
			return true;

		for(var key in this.parties)
			if(this.parties[key].orders===null)
				return false;
		return true;
	}

	this._validateOrders = function(party, orders) {
		if(!(party in this.parties) || this.parties[party].orders)
			return false;
		if(!orders.length)
			return true;

		var numInvalidOrders = 0;
		var unitsHavingOrders = {}; // ensure that at most one command per unit
		for(var i=0; i<orders.length; ++i) {
			var order = orders[i];

			var unit = order.unit;
			if(unit) {
				if(unit in unitsHavingOrders) {
					delete orders[i];
					++numInvalidOrders;
					continue;
				}
				unitsHavingOrders[unit] = true;
			}

			switch(order.type) {
			case 'move': {
				var unit = this.map.get(order.from_x, order.from_y).unit;
				if(!unit || unit.id != order.unit || unit.party.id != party) {
					delete orders[i];
					++numInvalidOrders;
					continue;
				}
				var distance = MatrixHex.distHex(unit, { x:order.to_x, y:order.to_y });
				if(distance==0 || distance>unit.type.move) {
					delete orders[i];
					++numInvalidOrders;
					continue;
				}
				break;
			}
			case 'surrender':
				if(order.party != party) {
					console.error('invalid order', order);
					delete orders[i];
					++numInvalidOrders;
				}
				break;
			default:
				console.error('invalid order type', order);
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

			if(!fromVisible && toVisible)
				events.push({type:'contact', x:evt.to_x, y:evt.to_y, party:party, unit:unit.serialize()});
			else if(fromVisible && !toVisible)
				events.push({type:'contactLost', x:evt.from_x, y:evt.from_y, party:party, unit:unit.id});
		}
	}

	this._evaluateSimEvents = function() {
		var events = [ ];
		var orders = this._mergeOrders();
		for(var i=0; i<orders.length; ++i) {
			var order = orders[i];
			switch(order.type) {
			case 'move': {
				var unit = this.map.get(order.from_x, order.from_y).unit;
				if( !this.map.unitMove(unit, { x:order.to_x, y:order.to_y }, events) ) {
					console.error('invalid move order', order);
					continue;
				}
				events.push(order);
				// TODO update party's fov
				this._evaluteContactEvents(unit, order, events);

				var dest = this.map.get(order.to_x, order.to_y);
				var opponent = dest.unit;
				if(opponent && !this._evaluateCombat(unit, opponent, events))
					continue;

				dest.unit = unit;
				if(dest.terrain == MD.OBJ && dest.party!=unit.party.id) { // objective captured
					if(dest.party in this.parties)
						--this.parties[dest.party].objectives;
					dest.party=unit.party.id;
					if(dest.party in this.parties)
						++this.parties[dest.party].objectives;
					events.push({type:'capture', x:order.to_x, y:order.to_y, party:unit.party.id});
				}
				break;
			}
			case 'surrender':
				events.push(order);
				this.parties[order.party].objectives = 0;
				break;
			default:
				console.error('invalid order', order);
			}
		}

		var isGameOver = this._isGameOver(events);
		if(!isGameOver) {
			events.push({type:'turn', turn:this.turn+1});
			this._updateProduction(events);
		}
		this._dispatchSimEvents(events);
		if(isGameOver)
			return;

		var self = this;
		++this.turn;
		this.turnStartTime = new Date()/1000.0;
		setTimeout(function(turn) {
			if(self.turn!=turn)
				return;
			console.log("turn", turn, "timeout");
			self._evaluateSimEvents();
		}, this.timePerTurn*1000, this.turn);
		for(var party in this.parties)
			this.parties[party].fov = this.map.getFieldOfView(party);
	}

	this._dispatchSimEvents = function(events) {
		if(!events || !events.length)
			return;
		for(var key in this.simEventListeners) {
			var evts = this._filterSimEvents(events, key); // filter events to be dispatched by the listeners' fov:
			this.simEventListeners[key](evts);
		}
		this.simEventCounter += events.length;
	}

	this._filterSimEvents = function(events, party) {
		if(!party)
			return events;
		
		var evts = [];
		var fov = this.parties[party].fov;

		for(var i=0, end=events.length; i!=end; ++i) {
			var evt = events[i];
			if('party' in evt) {
				if (evt.party == party)
					evts.push(evt);
				continue;
			}

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
			if(visible || !hasLocation)
				evts.push(evt);
		}
		return evts;
	}

	this._evaluateCombat = function(attacker, defender, events) {
		var attack = attacker.type.attack;
		var defense = defender.type.defend;
		var location = this.map.get(defender.x, defender.y);
		defense *= MD.Terrain[location.terrain].defend;

		// evaluate result:
		var score = Math.floor(Math.random()*(attack+defense));
		var event = { type:'combat', attack:attack, defense:defense, score:score, x:defender.x, y:defender.y};
		var looser;
		if(score<attack) { // attacker wins
			event.winner = attacker.id;
			event.looser = defender.id;
			looser = defender;
		}
		else {
			event.winner = defender.id;
			event.looser = attacker.id;
			looser = attacker;
		}
		events.push(event);
		if(looser.party in this.parties)
			--this.parties[looser.party].units;
		return looser==defender;
	}

	this._isGameOver = function(events) {
		var loosers = [];
		var winners = [];
		for(var key in this.parties) {
			var party = this.parties[key];
			if(!party.objectives)
				loosers.push(key);
			else
				winners.push(key);
		}
		if(!loosers.length)
			return false;
		events.push({ type:'gameOver', winners:winners, loosers:loosers});
		this.state = 'over';
		// todo add a timeout (3 days?) after which this match is cleaned up from memory
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
				// todo check immediate vicinity
				if(unit) {
					unit.type = tile.production;
					unit.party = tile.party;
					unit = this.map.unitAdd(unit);
					events.push({type:'production', x:unit.x, y:unit.y, unit:unit.serialize()});
					tile.progress = 0;
				}
				// todo communicate progress
			}
		}
	}

	this._initStats = function(scenario) {
		var parties = {};
		for(var key in scenario.starts)
			parties[key] = { objectives:1, units:0, orders:null, fov:this.map.getFieldOfView(key) };
		for(var key in scenario.units) {
			var unit = scenario.units[key];
			if(unit.party in parties)
				++parties[unit.party].units;
		}
		return parties;
	}

	this._init = function(params) {
		var defaults = {
			scenario:'baiazul',
			timePerTurn: 86400, // 1 day
			devMode: 1
		};
		for(var key in defaults)
			this[key] =(key in params) ?
				isNaN(parseInt(params[key])) ? params[key] : parseInt(params[key])
				: defaults[key];

		var scenarios = {
			fallback: { generator: "islandInhabited", seed: "pelagium", filterMinorObjectives:true },
			aborigina: {
				generator: "islandInhabited",
				seed: "pelagium_0_0",
				filterMinorObjectives:true,
				tiles: [ {x:24,y:19, terrain:1}, {x:24,y:20, terrain:3, id:12, party:1} ],
				starts: { 1:12, 2:6 }
			},
			baiazul: {
				generator: "islandInhabited",
				seed: "pelagium_281474976710655_0",
				filterMinorObjectives:true,
				tiles: [
					{x:12,y:17, terrain:1}, {x:13,y:18, terrain:3, id:4}, {x:19,y:14, terrain:2},
					{x:20,y:14, terrain:2}, {x:21,y:14, terrain:2}, {x:21,y:13, terrain:2},
					{x:22,y:14, terrain:2}, {x:10,y:25, terrain:2}
				],
				starts: { 1:0, 2:11 },
				units: [
					{type:'inf', party:1, x:6, y:12},
					{type:'inf', party:1, x:6, y:14},
					{type:'inf', party:1, x:5, y:14},
					{type:'art', party:1, x:6, y:13},
					{type:'art', party:1, x:5, y:13},
					{type:'inf', party:1, x:7, y:12},
					{type:'kv', party:1, x:21, y:15},
					{type:'kv', party:1, x:7, y:15},
					{type:'kv', party:2, x:22, y:15},
					{type:'kv', party:2, x:22, y:18},
					{type:'art', party:2, x:23, y:17},
					{type:'art', party:2, x:23, y:16},
					{type:'inf', party:2, x:22, y:17},
					{type:'inf', party:2, x:22, y:16},
					{type:'inf', party:2, x:21, y:16},
					{type:'inf', party:2, x:23, y:15},
				],
			},
			estrela: { generator: "islandInhabited", seed: "pelagium_9_5", filterMinorObjectives:true, starts: { 1:1, 2:7 } },
			laguna: { generator: "islandInhabited", seed: "pelagium_13_9", filterMinorObjectives:true, starts: { 1:3, 2:9 } },
			isthmia: { generator: "islandInhabited", seed: "pelagium_38_13", filterMinorObjectives:true, starts: { 1:6, 2:13 } },
			caldera: { generator: "islandInhabited", seed: "pelagium_11_13", filterMinorObjectives:true,
				tiles: [
					{x:11,y:17, terrain:0}, {x:12,y:17, terrain:0}, {x:12,y:18, terrain:0},
					{x:13,y:15, terrain:0}, {x:13,y:16, terrain:0}, {x:13,y:17, terrain:0},
					{x:13,y:18, terrain:0},{x:14,y:16, terrain:0}, {x:14,y:17, terrain:0},
					{x:15,y:17, terrain:0}, {x:16,y:14, terrain:1}, {x:16,y:17, terrain:0},
					{x:16,y:18, terrain:0},
				],
			},
		}
		var scenario;
		if(this.scenario in scenarios)
			scenario = scenarios[this.scenario];
		else {
			scenarios.fallback.seed = this.scenario;
			scenario = scenarios.fallback;
		}
		this.map = new MapHex(scenario);
	
		this.parties = this._initStats(scenario);
		this.simEventCounter = 0;
		this.turn = 1;
		this.turnStartTime = new Date()/1000.0;
		this.simEventListeners = { };
		this.state = 'init';
	}

	this._init(params);
	if(callback)
		callback({ party:params.party ? params.party : 1 }, this);
}

if(typeof module == 'object' && module.exports)
	module.exports = Sim;
