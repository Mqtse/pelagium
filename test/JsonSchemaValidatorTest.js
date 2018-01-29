const JsonValidator = require('../JsonSchemaValidator');
const fs = require('fs');
let schema;
try {
	schema = fs.readFileSync('./pelagium.schema.json');
	schema = JSON.parse(schema);
}
catch(err) {
	console.error('invalid JSON schema file:', err);
	process.exit(-1);
}

let validator = new JsonValidator(schema);
console.log('schema patterns loaded:', validator.keys());

let expectValidate = function(pattern, data, expected) {
		let result = validator.validate(pattern, data);
		if(JSON.stringify(result)==JSON.stringify(expected))
			return 0;
		console.error('unexpected validator result:', pattern, data,
			'\n\texpected:', expected, '\n\tactual:  ', result);
		return 1;
}

let errors = expectValidate('postOrders', { turn:1, orders:[
	{ type:'move', unit:123, from_x:17, from_y:5, to_x:16, to_y:5 },
	{ type:'production', x:5, y:5, unit:'kv' },
	{ type:'capitulate'}
]}, true);
errors += expectValidate('postOrders', {}, [ 400, 'postOrders: turn property expected' ]);
errors += expectValidate('postOrders', { turn:'2', orders:[]}, true);
errors += expectValidate('postOrders', { turn: 5, orders: 
	[ { type: 'production', unit: 'art', x: 20, y: 12 },
	  { type: 'move', unit: 7, from_x: 20, from_y: 11, to_x: {}, to_y: 12 } ] }, [ 400, 'postOrders.orders[].to_x: integer type expected' ]);

if(errors===0)
	console.log('OK');
else
	console.log(errors+' TESTS FAILED');
process.exit(errors);
