// based on https://stackoverflow.com/questions/52236641/electron-ipc-and-nodeintegration
process.once('loaded', () => {
	const { ipcRenderer } = require('electron');

	window.addEventListener('message', event => {
		const message = event.data;
		if (message.receiver === 'main')
			ipcRenderer.send('ipc', message);
	});

	ipcRenderer.on('ipc', (event, message) => {
		window.postMessage(message, '*')
	})
});
