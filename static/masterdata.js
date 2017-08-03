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
		{ id:0, color: "rgb(0,127,63)", name: 'Neutral' },
		{ id:1, color: "rgb(0,0,255)", name: 'Blue' },
		{ id:2, color: "rgb(255,0,0)", name: 'Red' },
	],
	Unit: {
		inf: {
			id: 'inf',
			name: 'infantry',
			move: 2,
			attack: 4,
			defend: 6,
			support:2,
			range: 1,
			visualRange:1,
			medium: 1,
			cost: 2
		},
		kv: {
			id: 'kv',
			name: 'cavallery',
			move: 3,
			attack: 4,
			defend: 3,
			support:0,
			range: 0,
			visualRange:2,
			medium: 1,
			cost: 3
		},
		art: {
			id: 'art',
			name: 'artillery',
			move: 1,
			attack: 0,
			defend: 1,
			support:3,
			range: 2,
			visualRange:1,
			medium: 1,
			cost: 4
		}
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
