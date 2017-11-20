var MD = {
	WATER: 0,
	PLAIN: 1,
	FOREST: 2,
	OBJ: 3,
	GROUND: 1,
	AIR:9,

	Terrain: [
		{
			id:0,
			color:'rgb(153,179,205)',
			name:'water',
			concealment:false,
			defend: 1,
			move: 1
		},
		{
			id:1,
			color:'hsl(62, 30%, 88%)',
			name:'plain',
			concealment:false,
			defend: 1,
			move: 1
		},
		{
			id:2,
			color:'rgb(192,215,173)',
			name:'forest',
			concealment:true,
			defend: 1.5,
			move: 3
		},
		{
			id:3,
			color: 'rgb(223,191,173)',
			name:'settlement',
			concealment:true,
			defend: 2,
			move: 1
		}
	],
	Party: [
		{ id:0, color: "rgb(127,127,127)", name: 'Neutral' },
		{ id:1, color: "rgb(0,0,255)", name: 'Blue' },
		{ id:2, color: "rgb(255,0,0)", name: 'Red' },
		{ id:3, color: "rgb(0,191,0)", name: 'Green' },
		{ id:4, color: "rgb(255,191,0)", name: 'Yellow' }
	],
	Unit: {
		inf: {
			id: 'inf',
			name: 'infantry',
			move: 2,
			attack: 3,
			defend: 4,
			support: 1,
			range: 1,
			visualRange: 1,
			retreat: 4,
			medium: 1,
			cost: 2
		},
		kv: {
			id: 'kv',
			name: 'cavallery',
			move: 3,
			attack: 4,
			defend: 2,
			support: 0,
			range: 0,
			visualRange: 2,
			retreat: 6,
			medium: 1,
			cost: 3
		},
		art: {
			id: 'art',
			name: 'artillery',
			move: 1,
			attack: 0,
			defend: 1,
			support: 3,
			range: 2,
			visualRange: 1,
			retreat: 1,
			medium: 1,
			cost: 4
		}
	},
	isNavigable: function(terrain, unitType) {
		if((unitType.medium == MD.GROUND && terrain == MD.WATER)
			|| (unitType.medium == MD.WATER && terrain != MD.WATER))
			return false;
		return true;
	}
};

settings = {
/// interface settings
	cellHeight:36,
	scales: [ 18, 26, 36, 52, 72 ],
	originX:0,
	originY:0,
	panMinDelta:4,
	party:1, // blue

/// simulation settings
	scenario:'baiazul',
	timePerTurn: 86400 // 1 day
};

if(typeof module == 'object' && module.exports)
	module.exports = MD;
