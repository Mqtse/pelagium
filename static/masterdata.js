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
			color:'hsl(207,30%,72%)',
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
			color:'rgb(195,205,173)',
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
		{ id:0, color: "rgb(0,0,0)", name: 'Neutral' },
		{ id:1, color: "rgb(0,0,255)", name: 'Blue' },
		{ id:2, color: "rgb(255,0,0)", name: 'Red' },
		{ id:3, color: "rgb(0,170,0)", name: 'Green' },
		{ id:4, color: "rgb(255,170,0)", name: 'Yellow' },
		{ id:5, color: "rgb(170,0,170)", name: 'Magenta' },
		{ id:6, color: "rgb(0,170,170)", name: 'Cyan' },
		{ id:7, color: "rgb(170,85,0)", name: 'Brown' }
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
			amphibious: true,
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
		},
		sail: {
			id: 'sail',
			name: 'sailing&nbsp;ship',
			move: 2,
			attack: 2,
			defend: 2,
			support: 2,
			range: 1,
			visualRange: 2,
			retreat: 5,
			medium: 0,
			cost: 4,
			capacity: 1,
			symbol: {
				width:256,
				height:256,
				coloredPaths:[
					"m 145.1608,34.088469 -3.65589,0.07461 1.39992,14.533252 3.86205,0.810893 z m -61.461004,5.886339 -3.657855,0.07657 1.810275,14.57252 3.917028,0.995455 z M 101.40986,173.89002 c -1.56179,0.0376 -3.137836,0.0937 -4.729879,0.17279 l 1.350834,10.87932 c -12.972348,-0.31627 -25.86542,-0.94272 -38.746174,-2.02429 l -4.9223,-0.43391 c -10.355836,-0.9657 -20.709749,-2.23747 -31.096682,-3.90133 l 18.432608,31.03582 c 1.640758,2.7616 4.635954,4.43248 7.847799,4.3804 l 121.151004,-1.879 c 2.49786,-0.0395 17.08232,-5.74735 23.05058,-22.53616 l 55.23499,-8.30528 -0.0334,-2.13424 -52.15243,4.83591 c -12.16036,0.2332 -24.12287,0.51813 -35.94437,0.75789 l -0.97975,-9.41462 c -1.57318,0.075 -3.1537,0.16727 -4.74166,0.27684 l 0.88943,9.23202 c -17.97869,0.34236 -35.64072,0.54017 -53.13414,0.21401 z"
				],
				monoPaths:[
					"M 126.62142,45.272241 118.04434,90.715513 103.07929,60.018054 66.413515,50.70351 56.613984,90.188438 55.841089,105.22104 31.495057,97.391375 3,160.40185 l 49.759498,4.78903 -0.750744,14.60629 c 21.313579,-3.939 48.200836,-7.70976 67.743036,-5.11126 l 0.15059,6.20416 c 4.18041,-1.04334 8.7168,-1.96642 13.44363,-2.75494 2.65497,1.13937 4.96652,2.53622 6.85746,4.22542 l -1.20694,-5.09022 c 23.54211,-3.28911 50.13282,-3.1875 61.42371,2.45818 L 195.84048,152.9863 C 207.612,168.71816 223.78684,177.51356 253,174.14224 l -64.2772,-62.72257 -2.8989,-16.9294 -21.83247,-41.359575 z"
				]
			}
		}
	},
	isNavigable: function(terrain, unitType) {
		if((unitType.medium == MD.GROUND && terrain == MD.WATER)
			|| (unitType.medium == MD.WATER && terrain != MD.WATER))
			return false;
		return true;
	}
};

if(typeof module == 'object' && module.exports)
	module.exports = MD;
