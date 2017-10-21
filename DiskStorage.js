const fs = require('fs');
const path = require('path');

module.exports = function(dir) {
	this.setItem = function(key, value, callback) {
		var data = JSON.stringify(value);
		if(callback===undefined)
			callback = function(err) { if(err) console.error('DiskStorage setItem('+key+',...) failed:', err); }
		fs.writeFile(this.path + path.sep + key + this.suffix, data, callback);
	}
	this.getItem = function(key) {
		var data = null;
		try {
			var data = fs.readFileSync(this.path + path.sep + key + this.suffix);
			data = JSON.parse(data);
		} catch(err) {
			console.error('DiskStorage getItem('+key+',...) failed:', err);
		}
		return data;
	}
	this.removeItem = function(key, callback) {
		if(callback===undefined)
			callback = function(err) { if(err) console.error('DiskStorage removeItem('+key+') failed:', err); }
		fs.unlink(this.path + path.sep + key + this.suffix, callback);
	}
	this.keys = function() {
		var data = null;
		try {
			data = fs.readdirSync(this.path);
		} catch(err) {
			console.error('DiskStorage keys() failed:', err);
		}
		data.forEach(function(id,index,array) { array[index] = id.substr(0, id.lastIndexOf('.')); });
		return data;
	}

	try {
		fs.accessSync(dir);
	} catch(err) {
		console.log('directory', dir, 'not accessible. Trying to create it...');
		fs.mkdirSync(dir, 0o750);
		console.log('directory', dir, 'creation successful.');
	}
	this.path = dir;
	this.suffix = '.json';
}
