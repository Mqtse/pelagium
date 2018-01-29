function JsonSchemaValidator(patterns) {
	this.validateItem = function(pattern, item, id, path) {
		if(!path)
			path = [];
		path.push(pattern.title ? pattern.title : id);
		let loc = function() {
			let s = '';
			for(let i=0, end = path.length; i!=end; ++i) {
				if(i>0 && path[i]!='[]')
					s += '.';
				s+= path[i];
			}
			return s+': ';
		}

		let type;
		if(pattern.type) {
			let types = (typeof pattern.type === 'string') ? [ pattern.type ] : pattern.type;
			if(!Array.isArray(types))
				return [ 500, 'schema error: type needs to be array or string'];

			let typeOk = false;
			for(let i=0, end = types.length; i!=end && !typeOk; ++i) {
				switch(types[i]) {
				case 'array':
					typeOk = Array.isArray(item);
					type = 'array';
					break;
				case 'null':
					typeOk = (item===null);
					type = 'null';
					break;
				case 'integer':
					typeOk = Number.isInteger(item);
					type = 'number';
					break;
				default:
					typeOk = (typeof item == types[i]);
					type = typeof item;
				}
			}
			if(!typeOk)
				return [400, loc()+types.join(' or ')+' type expected'];
		}

		if(pattern.enum) {
			for(let i=0, end = pattern.enum.length; i<end; ++i)
				if(item===pattern.enum[i]) {
					path.pop();
					return true;
				}
			return [400, loc()+"one of the following values expected: "+JSON.stringify(pattern.enum)];
		}

		if(type === 'array') {
			let numItems = item.length;
			if(('minItems' in pattern) && numItems<pattern.minItems)
				return [400, loc()+`at least ${pattern.minItems} array items expected`];
			if(('maxItems' in pattern) && numItems>pattern.maxItems)
				return [400, loc()+`at most ${pattern.maxItems} array items expected`];

			if('items' in pattern) {
				if(Array.isArray(pattern.items))
					return [ 500, 'array tuple validation not implemented' ];
				for(let i=0; i<numItems; ++i) {
					let result = this.validateItem(pattern.items, item[i], '[]', path);
					if(result!==true)
						return result;
				}
			}
		}
		else if(type === 'object') {
			if(Array.isArray(pattern.required)) {
				for(let i=0, end=pattern.required.length; i<end; ++i)
					if(!(pattern.required[i] in item))
						return [400, loc()+`${pattern.required[i]} property expected`];
			}
			let additionalProperties = true;
			if('additionalProperties' in pattern)
				additionalProperties = pattern.additionalProperties;
			if('properties' in pattern) for(let key in item) {
				let property = pattern.properties[key];
				if(!property) {
					if(additionalProperties)
						continue;
					return [400, loc()+`invalid property ${key}`];
				}
				let result = this.validateItem(property, item[key], key, path);
				if(result!==true)
					return result;
			}
		}
		else if(type === 'string') {
			let length = item.length;
			if(('minLength' in pattern) && length<pattern.minLength)
				return [400, loc()+`at least ${pattern.minLength} characters expected`];
			if(('maxLength' in pattern) && length>pattern.maxLength)
				return [400, loc()+`at most ${pattern.maxLength} characters expected`];
			if(('pattern' in pattern ) && item.match(pattern.pattern)===null)
				return [400, loc()+`string does not match pattern ${pattern.pattern}`];
		}
		else if(type === 'number') {
			if(('minimum' in pattern) && item<pattern.minimum)
				return [400, loc()+`a value greater than or equal to ${pattern.minimum} expected`];
			if(('exclusiveMinimum' in pattern) && item<=pattern.exclusiveMinimum)
				return [400, loc()+`a value greater than ${pattern.exclusiveMinimum} expected`];
			if(('maximum' in pattern) && item>pattern.maximum)
				return [400, loc()+`a value less tan or equal to ${pattern.maximum} expected`];
			if(('exclusiveMaximum' in pattern) && item>=pattern.exclusiveMaximum)
				return [400, loc()+`a value less than ${pattern.exclusiveMaximum} expected`];
		}
		path.pop();
		return true;
	}

	this.validate = function(schemaName, data) {
		let pattern = this.patterns[schemaName];
		if(!pattern)
			return [500, 'invalid JSON schema name '+schemaName ];
		return this.validateItem(pattern, data, schemaName);
	}
	this.keys = function() {
		let keys = [];
		for(let key in this.patterns)
			keys.push(key);
		return keys;
	}
	this.has = function(schemaName) {
		return schemaName in this.patterns;
	}

	this.patterns = {};
	for(let key in patterns) {
		if(key[0]!='$')
			this.patterns[key] = patterns[key];
	}
}

module.exports = JsonSchemaValidator;
