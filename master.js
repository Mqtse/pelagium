const os = require('os');
const httpUtils = require('./httpUtils');

let cfg = {
	ip:'0.0.0.0',
	port:1770,
	retainRequestBody: true,
	sslPath: false,
	redirectHttp: false,
	heartbeatInterval: 30,
}
httpUtils.parseArgs(process.argv.slice(2), cfg);
console.log(cfg);

let appServers = [
	{ url:'https://sufi.eludi.net' },
	//{ url:'https://pelagium-gcp01.eludi.net' },
];

//------------------------------------------------------------------
function AppMaster(cfg) {
	let counterGet = 0, counterPost = 0;
	this.systemsAvailable = new Map();
	let servers = [];
	const shardPrefixes = "ABCDEFGHKLMNPQRSTUVWXYZ123456789";

	this.delegate = function(req, resp, url) {
		if(url.path.length<2) {
			const shard = (req.method=='POST' ?
				counterPost++ : counterGet++) % shardPrefixes.length;
			req.headers['x-shard'] = shardPrefixes.charAt(shard);
			return httpUtils.delegate(req, resp, servers[shard]);
		}
		const shard = url.path[1].codePointAt(0) % servers.length;
		return httpUtils.delegate(req, resp, servers[shard]);

		if(!this.systemsAvailable.size)
			return false;

		const targetSystemCounter = Math.floor(Math.random()*this.systemsAvailable.size);
		let targetURL = null;
		let i=0;
		for (const [id, system] of this.systemsAvailable) {
			if(i++==targetSystemCounter) {
				targetURL = system.url ? system.url : {protocol:'https:', hostname:id};
				break;
			}
		}
		return httpUtils.redirect(req, resp, url, targetURL);
	}
	this.handleHeartbeat = function(req, resp, url) {
		if(req.method!='POST')
			return httpUtils.respond(resp, 404, 'heartbeat not found');
		const data = url.query.params;
		const sysURL = data.url || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
		//console.log('heartbeat from '+sysURL+':', JSON.stringify(data));

		if(data.evt == 'shutdown') {
			this.systemsAvailable.delete(sysURL);
			console.log('system shutdown', sysURL);
		}
		else {
			this.systemsAvailable.set(sysURL, {
				tLastUpdate:Date.now(),
				appConnections:data.process.connections,
				appDiskUsage:parseInt(data.pelagium.estimatedDiskUsage)/1024,
				sysMemFree:parseInt(data.system.memoryFree),
				sysLoadAvg:data.system.loadAvg[0]/data.system.cpuCount,
				url: data.url ? new URL(data.url) : null
			});
			console.log('heartbeat from '+sysURL+':', this.systemsAvailable.get(sysURL));
		}
		return httpUtils.respond(resp, 204);
	}
	this.monitorSystems = function() {
		const now = Date.now();
		this.systemsAvailable.forEach((system, id, container) => {
			if(now - system.tLastUpdate > 2*cfg.heartbeatInterval*1000) {
				console.log('system timeout '+id);
				container.delete(id);
			}
		});
	}

	for(let i=0; i<cfg.length; ++i)
		servers.push(new URL(cfg[i].url));

	//setInterval(()=>{ this.monitorSystems(); }, 2*cfg.heartbeatInterval*1000);
}

//------------------------------------------------------------------

let master = new AppMaster(appServers);
let proxyServer = httpUtils.createServer(cfg, (req, resp, url)=>{
	if(!url.path.length)
		return httpUtils.redirect(req, resp, url, { path:[ 'static', 'index.html' ] });

	//console.log(req.method, url.pathname, JSON.stringify(url.query));
	switch(url.path[0]) { // toplevel services:
	case 'ping':
		return httpUtils.respond(resp, 200, 'pong');
	case 'static':
	case 'labs':
		if(url.path.length==2)
			return httpUtils.serveStatic(resp, url.path[1], __dirname+'/'+url.path[0]);
		return false;
	case 'pelagium':
		return master.delegate(req, resp, url);
	case 'info':
		return proxyServer.usage(req, resp);
	case 'heartbeat':
		return master.handleHeartbeat(req, resp, url);
	}
});
proxyServer.startTime = new Date();
proxyServer.getUsageData = function(cb) {
	this.getConnections((err, count)=>{
		let upMins = Math.floor(((new Date())-this.startTime)/1000/60);
		let sysUpMins = Math.round(os.uptime()/60);
		let data = {
			process: {
				memoryUsage: process.memoryUsage(),
				connections: count,
				startTime: this.startTime.toISOString(),
				upTime:Math.floor(upMins/60/24)+'d '+(Math.floor(upMins/60)%24)+'h '+(upMins%60)+'m'
			},
			system: {
				memoryFree: `${Math.round(os.freemem() / 1048576)}MB`,
				memoryTotal: `${Math.round(os.totalmem() / 1048576)}MB`,
				loadAvg: os.loadavg(),
				cpuCount: os.cpus().length,
				uptime: Math.floor(sysUpMins/60/24)+'d '+(Math.floor(sysUpMins/60)%24)+'h '+(sysUpMins%60)+'m'
			}
		}
		for(let id in data.process.memoryUsage)
			data.process.memoryUsage[id] = Math.round(data.process.memoryUsage[id]/1024)+'kB';
		if('cpuUsage' in process)
			data.process.cpuUsage = process.cpuUsage()
		cb(data);
	});
}
proxyServer.usage = function(req, resp) {
	this.getUsageData((data)=>{
		httpUtils.respond(resp, 200, data);
	});
	return true;
}

let serverHttp = null;
if(proxyServer.isHttps && cfg.redirectHttp) {
	serverHttp = httpUtils.createServer({ ip:cfg.ip, port:cfg.redirectHttp },
		(req, resp, url)=>{
			return httpUtils.redirect(req, resp, url, { protocol:'https:', code:301 });
		}
	);
}

httpUtils.onShutdown(()=>{
	console.log( "shutting down." );
});
