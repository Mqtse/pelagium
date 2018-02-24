this.addEventListener('install', (event)=>{
	event.waitUntil(caches.open('static_001').then((cache)=>{
		return cache.addAll([
			'/static/icon_island192.png',
			'/static/icon_island256.png',
			'/static/eludi.logo.svg',
			'/static/favicon.ico',
			'/static/pelagium.svg',
			'/static/scillies.jpg'
		]);
	}));
});

this.addEventListener('fetch', (event)=>{
	event.respondWith(
		caches.match(event.request).then((response)=>{
			return response || fetch(event.request);
		})
	);
});

this.addEventListener('activate', (event)=>{
	let cacheWhitelist = ['static_001'];

	event.waitUntil(
		caches.keys().then((cacheNames)=>{
			return Promise.all(cacheNames.map((name)=>{
				if (cacheWhitelist.indexOf(name) === -1)
					return caches.delete(name);
			}));
		})
	);
});
