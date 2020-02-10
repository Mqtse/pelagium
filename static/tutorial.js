(()=>{
	function Tutorial(client) {
		let tapOrClick = screen.width<=800 ? 'tapping' : 'clicking';
		this.caption = function(msg) {
			document.querySelector('#tut_caption').innerHTML = msg;
			console.log(msg);
		}
		this.tooltip = function(x, y, msg, params={}) {
			const isLeft = ('align' in params) ? (params.align=='left'): (x>window.innerWidth/2);
			let widget = document.createElement('div');
			widget.className = isLeft ? 'speech-bubble-left' : (params.align=='right-bottom') ?
			'speech-bubble-right-bottom' : 'speech-bubble-right';

			if(params.mapSpace) {
				let pos = client.vp.mapToScreen({x:x, y:y});
				x = pos.x;
				y = pos.y;
			}

			widget.style.top = y+'px';
			if(isLeft)
				widget.style.left = x+'px';
			else
				widget.style.right = (window.innerWidth-x)+'px';

			widget.innerHTML = msg;
			let parent = document.querySelector('#tut_map');
			parent.appendChild(widget);
			if(params.duration)
				this.at(params.duration, ()=>{ parent.removeChild(widget); });
		}
		this.arrow = function(x1, y1, x2, y2, params={}) {
			let widget = document.createElement('div');
			widget.className = "arrow-pointer";

			if(params.mapSpace) {
				let pos = client.vp.mapToScreen({x:x1, y:y1});
				x1 = pos.x;
				y1 = pos.y;
				pos = client.vp.mapToScreen({x:x2, y:y2});
				x2 = pos.x;
				y2 = pos.y;
			}

			widget.style.left = x1+'px';
			widget.style.top = y1+'px';

			let length = Math.sqrt(Math.pow(x2-x1, 2)+Math.pow(y2-y1, 2));
			widget.style.width = Math.floor(length-24)+'px';
			widget.style.transform = 'rotate('+Math.atan2(y2-y1,x2-x1)+'rad)';
			widget.style.transformOrigin = '0 50% 0';
			document.querySelector('#tut_map').appendChild(widget);
		}
		this.at = function(deltaT, callback) {
			this.timeouts.push(setTimeout((step)=>{ if(step==this.currStep) callback(); },
				deltaT*1000, this.currStep));
		}
		this.step = function(delta=1, immediate=false) {
			for(var i=0; i<this.timeouts.length; ++i)
				clearTimeout(this.timeouts[i]);
			this.timeouts.length=0;

			const nextStep = this.currStep+delta;
			if(nextStep>=this.steps.length || nextStep<0)
				return client.close(false);

			let parent = document.querySelector('#tut_map');
			while(parent.lastChild)
				parent.removeChild(parent.lastChild);

			this.currStep += delta;
			this.steps[this.currStep](immediate);
		}

		let self = this;
		let enemy = null;
		this.steps = [
			(immediate)=>{
				self.caption("Welcome to the scenic islands of pelagium!");
				if(!immediate)
					client.viewCenter(10,8);
				//self.at(2.0, ()=>{ client.viewZoom(1.5, 10,10); });
			},
			(immediate)=>{
				self.caption("In order to win a scenario, you have to capture the majority of its settlements.");
				self.at(immediate ? 0.0 : 1.0, ()=>{
					[
						{x:6, y:6, mapSpace:true, align:'right'},
						{x:8, y:11, mapSpace:true, align:'right'},
						{x:11, y:5, mapSpace:true, align:'left'},
						{x:12,y:12, mapSpace:true, align:'right'}
					].forEach((params)=>{
						self.tooltip(params.x, params.y, "objective", params);
					});
				});
			},
			()=>{
				if(window.innerHeight>window.innerWidth)
					client.viewCenter(8,8);
				self.caption("Settlements under your party's control allow you to train new units.");
				self.tooltip(6,6, "settlement<br/>(yours)", {mapSpace:true, align:'right'});
			},
			(immediate)=>{
				client.deselectUnit();
				client.handleMapInput('click', 6, 6);
				self.caption("There are three different types of units: infantry, cavalry, artillery.");
				self.at(immediate ? 0.0 : 2, ()=>{
					self.tooltip(window.innerWidth-64,window.innerHeight-152, 'infantry', {align:'right-bottom'});
				});
				self.at(immediate ? 0.0 : 3, ()=>{
					self.tooltip(window.innerWidth-64,window.innerHeight-96, 'cavalry', {align:'right-bottom'});
				});
				self.at(immediate ? 0.0 : 4, ()=>{
					self.tooltip(window.innerWidth-64,window.innerHeight-48, 'artillery', {align:'right-bottom'});
				});
			},
			()=>{
				self.caption("Each unit type has its particular strengths and weaknesses.");
				client.handleMapInput('click', 5, 5);
				self.tooltip(5,5, "infantry<br/>(+defense)", {mapSpace:true, align:'right', duration:1.5});
				self.at(1.5, ()=>{ 
					client.handleMapInput('click', 5, 6);
					self.tooltip(5,6, "artillery<br/>(+support)", {mapSpace:true, align:'right', duration:1.5});
				});
				self.at(3.0, ()=>{
					client.handleMapInput('click', 6, 7);
					self.tooltip(6,7, "cavalry<br/>(+attack)", {mapSpace:true, align:'left', duration:1.5});
				});
				self.at(4.5, ()=>{ self.step(0); });
			},
			(immediate)=>{
				self.caption(tapOrClick+" on one of your units lets you see its properties and field of movement.");
				client.deselectUnit();
				client.handleMapInput('click', 6, 7);
				self.tooltip(6, 7, 'selected</br>unit', {mapSpace:true, align:'left'});
				self.at(immediate ? 0.0 : 1.5, ()=>{
					self.tooltip(160, window.innerHeight-112, 'unit<br/>properties', {align:'left'});
				});
				self.at(immediate ? 0.0 : 3.0, ()=>{
					self.tooltip(6, 9, 'dotted =</br>reachable', {mapSpace:true, align:'right'});
				});
			},
			()=>{
				self.caption(tapOrClick+" on a tile within the field of movement makes the unit move thereto.");
				if(!client.selUnit || client.selUnit.x!=6 || client.selUnit.y!=7)
					client.handleMapInput('click', 6, 7);
				if(client.selUnit)
					client.handleMapInput('click', 8, 8);
			},
			(immediate)=>{
				self.caption("When you are done with giving orders, press on the button \"next turn\".");
				client.handleMapInput('click', 7, 6);
				if(client.selUnit)
					client.handleMapInput('click', 7, 8);

				client.handleMapInput('click', 5, 6);
				if(client.selUnit)
					client.handleMapInput('click', 6, 7);
	
				client.handleMapInput('click', 5, 5);
				if(client.selUnit)
					client.handleMapInput('click', 5, 6);

				client.btnMain.setFocus(true);
				self.at(immediate ? 0.0 : 2.0, ()=>{
					self.tooltip(window.innerWidth-64,window.innerHeight-48, 'next turn', {align:'right-bottom'});
				});

			},
			()=>{
				client.handleUIEvent({type:'fwd'});
				self.caption("As soon as all players have given their orders, the turn will be evaluated.");
				self.at(4, ()=>{ self.step(); });
			},
			()=>{
				client.handleUIEvent({type:'spinner'});
				self.caption("Units move round-robin in the same sequence as they were given orders.");
			},
			()=>{
				self.caption("If a unit enters a tile occupied by another party's unit, a battle ensues.");
				enemy = client.mapView.get(8,9).unit;
				if(enemy) {
					client.moveUnit(enemy, 8,8);
					self.at(1.0, ()=>{
						self.tooltip(8, 8, 'battle', {mapSpace:true, align:'left'});
					});
				}
			},
			()=>{
				self.caption("Nearby units of the same party may support their comrades.");
				self.tooltip(7, 8, 'support<br/>(blue)', {mapSpace:true, align:'right', duration:1.5});
				self.tooltip(6, 7, 'support<br/>(blue)', {mapSpace:true, align:'right', duration:1.5});
				self.at(1.5, ()=>{
					self.tooltip(9, 7, 'support<br/>(red)', {mapSpace:true, align:'left'});
				});
				self.at(4.0, ()=>{ self.step(0); });
			},
			()=>{
				self.caption("Also the terrain has a significant effect on the battle's outcome.");
				client.deselectUnit();
				client.handleMapInput('click', 6, 8);
				self.tooltip(6, 8, 'plain', {mapSpace:true, align:'right', duration:1.5});
				self.tooltip(192, window.innerHeight-105, 'terrain<br/>properties', {align:'left'});
				
				self.at(1.5, ()=>{
					client.deselectUnit();
					client.handleMapInput('click', 9, 8);
					self.tooltip(9, 8, 'forest<br/>(+defense)', {mapSpace:true, align:'left', duration:1.5});
				});
				self.at(3, ()=>{
					client.deselectUnit();
					client.handleMapInput('click', 8, 11);
					self.tooltip(8, 11, 'settlement<br/>(++defense)', {mapSpace:true, align:'right'});
				});
				self.at(4.5, ()=>{ self.step(0); });
			},
			()=>{
				self.caption("The engagement ends with one unit involved either surrendering or retreating.");
				if(window.innerHeight>window.innerWidth)
					client.viewCenter(11,8);
				if(enemy)
					client.moveUnit(enemy, 9,8);
				self.at(1, ()=>{
					self.tooltip(9, 8, 'opponent<br/>retreats', {mapSpace:true, align:'left'});
				});
			},
			(immediate)=>{
				self.caption("Thus key for success is distributing forces in a way that they"
					+ " optimally serve your strategic goals.");

				self.at(immediate ? 0.0 : 1.5, ()=>{
					self.arrow(6,6, 8,8, {mapSpace:true});
					self.tooltip(8, 8, 'step 1:<br/>defend', {mapSpace:true, align:'left'});
				});
				self.at(immediate ? 0.0 : 3.0, ()=>{
					self.arrow(8,8, 8,11, {mapSpace:true});
					self.tooltip(8, 11, 'step 2:<br/>secure', {mapSpace:true, align:'right'});
				});
				self.at(immediate ? 0.0 : 4.5, ()=>{
					self.arrow(8,11, 12,12, {mapSpace:true});
					self.tooltip(12, 12, 'step 3:<br/>victory!', {mapSpace:true, align:'left'});
				});
			},
			()=>{
				self.caption("OK, enough with theory, let's gain some real experience!");
			}
		];

		this.handleClientEvent = function(evt, data) {
			switch(evt) {
			case 'fastDraw':
				document.querySelector('#tut_ovl').style.display = 'none';
				break;
			case 'fullDraw':
				document.querySelector('#tut_ovl').style.display = '';
				return this.step(0, true);
			case 'fwd':
			case 'spinner':
				return this.step();
			case 'mapInput':
				client.deselectUnit();
				return client.handleMapInput('click', data.x, data.y);
			default:
				console.log('client event received:', evt, data);
			}
		}

		this.currStep = 0;
		this.timeouts = [];
		document.querySelector('#tut_fwd').addEventListener("click", ()=>{ this.step(+1); });
		client.on('*', (evt, data)=>{ this.handleClientEvent(evt, data); });
		setInterval(()=>{ client.foregroundParty = (client.foregroundParty==0) ? 1 : 0; }, 1000);
	
		eludi.click2touch();
		client.toggleInfo(true);
		this.step(0);
	}

	const tStart = new Date();
	function waitForClient() {
		if(client.state!='input' && client.state!='waiting')
			return setTimeout(waitForClient, 200);
		window.tutorial = new Tutorial(client);
	}
	waitForClient();
})();
